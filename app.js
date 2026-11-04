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
function redColor(rgb){
  if(!rgb)return false;const [r,g,b]=rgb;
  return r>=0.58 && g<=0.16 && b<=0.16 && r>g*3 && r>b*3;
}
function rgbFromArgs(fn,args,OPS){
  const name=OPS[fn];
  const value=args?.[0];
  if(typeof value==="string"){
    const hex=value.match(/^#?([0-9a-f]{6})$/i);
    if(hex)return [parseInt(hex[1].slice(0,2),16)/255,parseInt(hex[1].slice(2,4),16)/255,parseInt(hex[1].slice(4,6),16)/255];
    const rgb=value.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
    if(rgb)return [Number(rgb[1])/255,Number(rgb[2])/255,Number(rgb[3])/255];
  }
  if((name==="setFillRGBColor"||name==="setFillColor"||name==="setFillColorN") && value?.length>=3){
    const scale=Math.max(value[0],value[1],value[2])>1?255:1;
    return [value[0]/scale,value[1]/scale,value[2]/scale];
  }
  if(name==="setFillGray" && typeof value==="number")return [value,value,value];
  return null;
}
function glyphText(glyphs){
  if(!Array.isArray(glyphs))return "";
  return glyphs.map(g=>typeof g==="string"?g:(g?.unicode||"")).join("");
}
// Approximate text-item fill colors by aligning glyph strings in PDF drawing order.
async function pageTextLines(page){
  const [content,ops]=await Promise.all([page.getTextContent({includeMarkedContent:true}),page.getOperatorList()]);
  const OPS=pdfjsLib.OPS;
  let color=[0,0,0], chunks=[];
  for(let i=0;i<ops.fnArray.length;i++){
    const fn=ops.fnArray[i], args=ops.argsArray[i];
    const next=rgbFromArgs(fn,args,OPS);if(next)color=next;
    const name=OPS[fn];
    if(name==="showText"||name==="showSpacedText"||name==="nextLineShowText"||name==="nextLineShowTextAndSpace"){
      const raw=name==="showSpacedText"?(args?.[0]||[]):(args?.[0]||[]);
      chunks.push({text:glyphText(raw),red:redColor(color)});
    }
  }
  let joined=chunks.map(c=>c.text).join("");
  let cursor=0;
  const items=(content.items||[]).filter(x=>typeof x.str==="string"&&x.str.trim());
  const mapped=items.map(item=>{
    const target=item.str;
    let at=joined.indexOf(target,cursor);
    let isRed=false;
    if(at>=0){
      let pos=0, votes=0, reds=0;
      for(const c of chunks){
        const start=pos,end=pos+c.text.length;
        const overlap=Math.max(0,Math.min(at+target.length,end)-Math.max(at,start));
        votes+=overlap;if(c.red)reds+=overlap;pos=end;
      }
      isRed=reds>0 && reds>=votes*0.35;
      cursor=at+target.length;
    } else {
      // If glyph mapping is unavailable, leave color unclassified rather than guessing.
    }
    const y=item.transform?.[5]??0;
    return {text:item.str,red:isRed,y,x:item.transform?.[4]??0};
  });
  // Group text fragments into visual lines by baseline.
  const groups=[];
  for(const it of mapped){
    let g=groups.find(x=>Math.abs(x.y-it.y)<3);
    if(!g){g={y:it.y,parts:[]};groups.push(g)}
    g.parts.push(it);
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
