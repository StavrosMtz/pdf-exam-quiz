import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = id => document.getElementById(id);
const DB_NAME = "pdf-exam-quiz-pwa";
const DB_VERSION = 1;
let db;
let questions = [];
let wrongIds = new Set();
let quiz = [];
let current = null;
let currentOptions = [];
let selectedIndex = null;
let answered = 0, score = 0, wrongThisRun = [];
let timerHandle = null, timeLeft = 90, active = false, evaluated = false;
let deferredInstall = null;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("questions"))d.createObjectStore("questions",{keyPath:"id"});if(!d.objectStoreNames.contains("wrong"))d.createObjectStore("wrong",{keyPath:"id"});if(!d.objectStoreNames.contains("pdfs"))d.createObjectStore("pdfs",{keyPath:"name"});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store)}
function getAll(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,value){return new Promise((res,rej)=>{const r=tx(store,"readwrite").put(value);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function del(store,key){return new Promise((res,rej)=>{const r=tx(store,"readwrite").delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function showToast(message){const t=$("toast");t.textContent=message;t.style.display="block";setTimeout(()=>t.style.display="none",3200)}
function showScreen(id){for(const s of ["homeScreen","quizScreen","resultsScreen"])$(s).classList.toggle("hidden",s!==id)}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function normalize(s){return s.replace(/\s+/g," ").trim()}
function redColor(r,g,b){
  // Allow for anti-aliased red glyph pixels on the rendered page.
  return r>105 && r>g*1.22 && r>b*1.22 && g<190 && b<190;
}
async function pageTextLines(page){
  // Detect answer color from the actual rendered PDF pixels instead of trying
  // to reconstruct PDF drawing operators (which varies between PDF producers).
  const scale=1.35;
  const viewport=page.getViewport({scale});
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  await page.render({canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent();
  const groups=[];
  for(const item of (content.items||[])){
    if(typeof item.str!=="string"||!item.str.trim())continue;
    const t=item.transform||[1,0,0,1,0,0];
    const rect=viewport.convertToViewportRectangle([
      t[4],t[5],t[4]+Math.max(item.width||0,1),t[5]+Math.max(item.height||Math.hypot(t[2],t[3])||9,1)
    ]);
    const x0=Math.max(0,Math.floor(Math.min(rect[0],rect[2])-2));
    const x1=Math.min(canvas.width,Math.ceil(Math.max(rect[0],rect[2])+2));
    const y0=Math.max(0,Math.floor(Math.min(rect[1],rect[3])-2));
    const y1=Math.min(canvas.height,Math.ceil(Math.max(rect[1],rect[3])+2));
    let redPixels=0,inkPixels=0;
    if(x1>x0&&y1>y0){
      const pixels=ctx.getImageData(x0,y0,x1-x0,y1-y0).data;
      for(let i=0;i<pixels.length;i+=4){
        const r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];
        if(a>40&&(r<245||g<245||b<245))inkPixels++;
        if(a>40&&redColor(r,g,b))redPixels++;
      }
    }
    const isRed=redPixels>=2 && redPixels/Math.max(inkPixels,1)>0.035;
    const y=t[5]||0;
    let group=groups.find(g=>Math.abs(g.y-y)<3.2);
    if(!group){group={y,parts:[]};groups.push(group)}
    group.parts.push({text:item.str,x:t[4]||0,red:isRed});
  }
  groups.sort((a,b)=>b.y-a.y);
  return groups.map(g=>{
    g.parts.sort((a,b)=>a.x-b.x);
    return {text:normalize(g.parts.map(p=>p.text).join(" ")),red:g.parts.some(p=>p.red)};
  }).filter(x=>x.text);
}
function parseLines(lines,source,pageNo){
  const starts=[];for(let i=0;i<lines.length;i++)if(/^\d{1,4}\.\s*/.test(lines[i].text))starts.push(i);
  const out=[];
  for(let q=0;q<starts.length;q++){
    const chunk=lines.slice(starts[q],starts[q+1]??lines.length);
    const m=chunk[0].text.match(/^(\d{1,4})\.\s*(.*)$/);if(!m)continue;
    let qtext=m[2],opts=[],cur=null;
    for(const line of chunk.slice(1)){
      const om=line.text.match(/^([αβγδ])\.\s*(.*)$/i);
      if(om){if(cur)opts.push(cur);cur={label:om[1].toLowerCase(),text:om[2],correct:line.red};}
      else if(cur){cur.text=normalize(cur.text+" "+line.text);cur.correct=cur.correct||line.red;}
      else qtext=normalize(qtext+" "+line.text);
    }
    if(cur)opts.push(cur);
    if(opts.length===4&&opts.filter(o=>o.correct).length===1){
      const number=Number(m[1]);
      out.push({id:`${source}::${pageNo}::${number}::${out.length}`,number,question:normalize(qtext),options:opts,source,page:pageNo});
    }
  }
  return out;
}
async function importFiles(files){
  if(!files.length)return;
  showToast("Reading PDF files…");
  let total=0;
  for(const file of files){
    try{
      const bytes=await file.arrayBuffer();
      const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
      const extracted=[];
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p);
        const lines=await pageTextLines(page);
        extracted.push(...parseLines(lines,file.name,p));
      }
      for(const q of extracted)await put("questions",q);
      await put("pdfs",{name:file.name,count:extracted.length,pages:pdf.numPages});
      total+=extracted.length;
      if(extracted.length===0){
        showToast(`${file.name}: PDF opened, but no valid questions were detected. Check that it contains selectable text and red answers.`);
      }
    }catch(e){console.error(e);showToast(`Could not read ${file.name}: ${e.message||e}`)}
  }
  await refreshData();
  showToast(`Imported ${total} questions.`);
}
async function refreshData(){
  questions=await getAll("questions");
  const wrong=await getAll("wrong");wrongIds=new Set(wrong.map(x=>x.id));
  $("loadedCount").textContent=questions.length;
  $("wrongCount").textContent=wrongIds.size;
  $("retryWrong").disabled=wrongIds.size===0;
  $("retryFromResults").disabled=wrongIds.size===0;
  $("retryHint").textContent=wrongIds.size?`${wrongIds.size} question(s) are waiting for another attempt.`:"No saved mistakes yet.";
  const pdfs=await getAll("pdfs");
  $("libraryList").innerHTML=pdfs.length?pdfs.map(p=>`<div class="library-item"><div><strong>${escapeHTML(p.name)}</strong><small>${p.count} questions · ${p.pages} pages</small></div><button class="remove-btn" data-remove="${escapeHTML(p.name)}">Remove</button></div>`).join(""):"<p class='hint'>No PDFs imported yet.</p>";
  $("libraryList").querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",()=>removePdf(b.dataset.remove)));
}
async function removePdf(name){
  const qs=questions.filter(q=>q.source===name);
  for(const q of qs){await del("questions",q.id);await del("wrong",q.id)}
  await del("pdfs",name);await refreshData();showToast("PDF and its questions removed.");
}
function startQuiz(list,isRetry=false){
  if(!list.length){showToast("There are no questions available.");return}
  const count=$("questionCount").value;
  let chosen=isRetry?[...list]:(count==="all"?[...list]:shuffle([...list]).slice(0,Math.min(Number(count),list.length)));
  quiz=shuffle(chosen);answered=0;score=0;wrongThisRun=[];showScreen("quizScreen");nextQuestion();
}
function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
function clearTimer(){if(timerHandle)clearInterval(timerHandle);timerHandle=null}
function setTimer(){
  clearTimer();timeLeft=90;active=true;evaluated=false;updateTimer();
  timerHandle=setInterval(()=>{timeLeft--;updateTimer();if(timeLeft<=0){clearTimer();evaluate(true)}},1000);
}
function updateTimer(){
  $("timer").textContent=`${String(Math.floor(timeLeft/60)).padStart(2,"0")}:${String(timeLeft%60).padStart(2,"0")}`;
  $("timer").classList.toggle("warning",timeLeft<=20);
}
function nextQuestion(){
  clearTimer();
  if(!quiz.length){finishQuiz();return}
  current=quiz.shift();currentOptions=shuffleAnswers()?shuffle(current.options):[...current.options];selectedIndex=null;evaluated=false;
  $("source").textContent=`Source PDF: ${current.source} · Page ${current.page}`;
  $("questionText").textContent=`Question ${current.number}\n\n${current.question}`;
  $("progress").textContent=`Question ${answered+1} of ${answered+quiz.length+1}`;
  $("feedback").textContent="";$("feedback").className="feedback";
  $("answers").innerHTML="";
  currentOptions.forEach((o,i)=>{
    const b=document.createElement("button");b.className="answer-btn";b.textContent=`${o.label}.  ${o.text}`;
    b.addEventListener("click",()=>choose(i));$("answers").appendChild(b);
  });
  $("selectAnswer").disabled=true;$("nextQuestion").classList.add("hidden");setTimer();
}
function shuffleAnswers(){return $("shuffleAnswers").checked}
function choose(i){
  if(!active||evaluated)return;selectedIndex=i;
  [...$("answers").children].forEach((b,j)=>b.classList.toggle("selected",j===i));
  $("feedback").textContent="Answer selected. You can change it, or press Select to submit.";
  $("feedback").className="feedback neutral";$("selectAnswer").disabled=false;
}
async function evaluate(timeout=false){
  if(evaluated)return;clearTimer();active=false;evaluated=true;answered++;
  const correctIndex=currentOptions.findIndex(o=>o.correct);
  const correct=currentOptions[correctIndex];
  const buttons=[...$("answers").children];buttons.forEach(b=>b.disabled=true);
  if(timeout||selectedIndex===null){
    wrongThisRun.push(current);await put("wrong",current);
    $("feedback").textContent=timeout?`Time's up. Correct answer: ${correct.label}. ${correct.text}`:`No answer selected. Correct answer: ${correct.label}. ${correct.text}`;
    $("feedback").className="feedback bad";
  }else if(currentOptions[selectedIndex].correct){
    score++;await del("wrong",current.id);
    buttons[selectedIndex].classList.remove("selected");buttons[selectedIndex].classList.add("correct");
    $("feedback").textContent="✓ Correct!";$("feedback").className="feedback good";
  }else{
    wrongThisRun.push(current);await put("wrong",current);
    buttons[selectedIndex].classList.remove("selected");buttons[selectedIndex].classList.add("incorrect");
    buttons[correctIndex].classList.add("correct");
    $("feedback").textContent=`Incorrect. Correct answer: ${correct.label}. ${correct.text}`;
    $("feedback").className="feedback bad";
  }
  $("selectAnswer").disabled=true;$("nextQuestion").classList.remove("hidden");
  await refreshData();
}
async function finishQuiz(){
  clearTimer();active=false;showScreen("resultsScreen");
  $("resultScore").textContent=`${score} / ${answered}`;
  const pct=answered?score/answered*100:0;
  $("resultPercent").textContent=`${pct.toFixed(1)}% correct`;
  $("resultWrong").textContent=`${wrongThisRun.length} question(s) answered incorrectly or timed out.`;
  const list=await getAll("wrong");
  $("wrongReview").innerHTML=list.length?list.map(q=>`<div class="review-item"><strong>${escapeHTML(q.question)}</strong><small>${escapeHTML(q.source)} · Page ${q.page} · Correct: ${escapeHTML(q.options.find(o=>o.correct)?.label||"—")}</small></div>`).join(""):"<p class='hint'>Excellent — no saved mistakes!</p>";
  await refreshData();
}
$("pdfInput").addEventListener("change",e=>importFiles([...e.target.files]));
$("startQuiz").addEventListener("click",()=>startQuiz(questions));
$("retryWrong").addEventListener("click",async()=>{const list=await getAll("wrong");startQuiz(list,true)});
$("retryFromResults").addEventListener("click",async()=>{const list=await getAll("wrong");startQuiz(list,true)});
$("selectAnswer").addEventListener("click",()=>evaluate(false));
$("nextQuestion").addEventListener("click",nextQuestion);
$("homeBtn").addEventListener("click",()=>{clearTimer();active=false;showScreen("homeScreen")});
$("backHome").addEventListener("click",()=>showScreen("homeScreen"));

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").classList.remove("hidden")});
$("installBtn").addEventListener("click",async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").classList.add("hidden")});

if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
db=await openDB();await refreshData();
