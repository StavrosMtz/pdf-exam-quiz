import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = id => document.getElementById(id);
const DB_NAME = "pdf-exam-quiz-import-v2";
const DB_VERSION = 1;
const PDFJS_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs"
];
let db, questions=[], wrongIds=new Set(), quiz=[], current=null, currentOptions=[];
let selectedIndex=null, answered=0, score=0, timerHandle=null, timeLeft=90, active=false, evaluated=false, deferredInstall=null;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      for(const name of ["questions","wrong","pdfs"]) if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,{keyPath:"id"});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
function all(store){
  return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
function writeMany(store,items){
  return new Promise((resolve,reject)=>{
    const t=db.transaction(store,"readwrite"),s=t.objectStore(store);
    for(const item of items)s.put(item);
    t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error("Storage transaction aborted"));
  });
}
function deleteSource(source){
  return new Promise(async(resolve,reject)=>{
    try{
      const qs=await all("questions"),ws=await all("wrong");
      const t=db.transaction(["questions","wrong"],"readwrite");
      qs.filter(q=>q.source===source).forEach(q=>t.objectStore("questions").delete(q.id));
      ws.filter(q=>q.source===source).forEach(q=>t.objectStore("wrong").delete(q.id));
      t.oncomplete=resolve;t.onerror=()=>reject(t.error);
    }catch(e){reject(e);}
  });
}
function removeKey(store,key){
  return new Promise((resolve,reject)=>{const r=db.transaction(store,"readwrite").objectStore(store).delete(key);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
}
function saveWrong(q){return writeMany("wrong",[q]);}
function removeWrong(q){return removeKey("wrong",q.id);}
function toast(message,ms=4200){const t=$("toast");t.textContent=message;t.classList.remove("hidden");clearTimeout(toast.handle);toast.handle=setTimeout(()=>t.classList.add("hidden"),ms);}
function screen(id){["homeScreen","quizScreen","resultsScreen"].forEach(s=>$(s).classList.toggle("hidden",s!==id));window.scrollTo({top:0,behavior:"smooth"});}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function norm(s){return String(s??"").replace(/\s+/g," ").trim();}
function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}
function redColor(r,g,b){return r>70 && r>g*1.25 && r>b*1.25 && g<215 && b<215;}

// Render each PDF page once. Each PDF.js text item is tested against the pixels
// in its glyph area, so red trailing spaces are not mistaken for red answers.
async function pageTextLines(page,pageNo){
  const scale=1.8,viewport=page.getViewport({scale});
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent(), groups=[];
  for(const item of content.items||[]){
    if(typeof item.str!=="string"||!item.str.trim())continue;
    const t=item.transform||[1,0,0,1,0,0],style=content.styles?.[item.fontName]||{};
    const h=Math.max(item.height||Math.hypot(t[2],t[3])||9,5);
    const ascent=Number.isFinite(style.ascent)?style.ascent:0.86;
    const descent=Number.isFinite(style.descent)?style.descent:-0.22;
    const x=Number(t[4])||0,y=Number(t[5])||0,w=Math.max(Number(item.width)||0,h*.35);
    const rect=viewport.convertToViewportRectangle([x,y+descent*h,x+w,y+ascent*h]);
    const x0=Math.max(0,Math.floor(Math.min(rect[0],rect[2])-2));
    const x1=Math.min(canvas.width,Math.ceil(Math.max(rect[0],rect[2])+2));
    const y0=Math.max(0,Math.floor(Math.min(rect[1],rect[3])-2));
    const y1=Math.min(canvas.height,Math.ceil(Math.max(rect[1],rect[3])+2));
    let red=0,ink=0;
    if(x1>x0&&y1>y0){
      const px=ctx.getImageData(x0,y0,x1-x0,y1-y0).data;
      for(let i=0;i<px.length;i+=4){
        const r=px[i],g=px[i+1],b=px[i+2],a=px[i+3];
        if(a>20&&(r<247||g<247||b<247))ink++;
        if(a>20&&redColor(r,g,b))red++;
      }
    }
    const isRed=red>=2 && red/Math.max(ink,1)>.10;
    let group=groups.find(g=>Math.abs(g.y-y)<2.8);
    if(!group){group={y,parts:[]};groups.push(group);}
    group.parts.push({text:item.str,x,red:isRed});
  }
  groups.sort((a,b)=>b.y-a.y);
  const lines=groups.map(g=>({text:norm(g.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(" ")),red:g.parts.some(p=>p.red),page:pageNo})).filter(x=>x.text);
  canvas.width=0;canvas.height=0;
  page.cleanup?.();
  return lines;
}
function isFurniture(text,titles){
  const s=norm(text);
  return /Σελίδα\s+\d+\s+από\s+\d+/i.test(s) ||
    /^σελίδα\s+\d+\s*$/i.test(s) ||
    /^μητρώο\s+θεμάτων\s+γνώσεων$/i.test(s) ||
    /^μ\s*η\s*τ\s*ρ\s*ώ\s*ο$/i.test(s) ||
    /^θ\s*ε\s*μ\s*ά\s*τ\s*ω\s*ν$/i.test(s) ||
    /^γ\s*ν\s*ώ\s*σ\s*ε\s*ω\s*ν$/i.test(s) ||
    /^γνωστικό\s+αντικείμενο\s*:/i.test(s) || titles.includes(s);
}
function parseDocument(allLines,source){
  const titles=allLines.map(l=>l.text.match(/^\s*Γνωστικό\s+Αντικείμενο\s*:\s*(.+)$/i)?.[1]).filter(Boolean).map(norm);
  const lines=allLines.filter(l=>!isFurniture(l.text,titles));
  const candidates=[];
  for(let i=0;i<lines.length;i++){
    const m=lines[i].text.match(/^\s*(\d{1,3})\s*[.)]\s*(.*)$/);
    if(m)candidates.push({index:i,number:Number(m[1]),text:m[2],page:lines[i].page});
  }
  const starts=candidates.filter((c,i)=>c.number===1||candidates[i-1]?.number===c.number-1||candidates[i+1]?.number===c.number+1);
  const out=[];
  for(let n=0;n<starts.length;n++){
    const st=starts[n],end=starts[n+1]?.index??lines.length,chunk=lines.slice(st.index,end);
    let question=st.text,options=[],currentOption=null;
    for(const line of chunk.slice(1)){
      const m=line.text.match(/^\s*([αβγδ]|[a-d])(?:\s*[.)]\s*(.*)|\s*)$/i);
      if(m){
        if(currentOption)options.push(currentOption);
        currentOption={label:m[1].toLowerCase(),text:m[2]||"",correct:!!line.red};
      }else if(currentOption){
        currentOption.text=norm(currentOption.text+" "+line.text);
        currentOption.correct=currentOption.correct||!!line.red;
      }else question=norm(question+" "+line.text);
    }
    if(currentOption)options.push(currentOption);
    if(options.length>=3){
      const redCount=options.filter(o=>o.correct).length;
      out.push({
        id:`${source}::${st.page}::${st.number}::${out.length}`,
        number:st.number,question:norm(question),options,source,page:st.page,
        gradeable:options.length===4&&redCount===1,
        answerKeyStatus:options.length!==4?"option-count":redCount===0?"unmarked":redCount>1?"multiple-red":"single"
      });
    }
  }
  return {questions:out,candidates:starts.length,invalid:out.filter(q=>!q.gradeable)};
}
function updateProgress(label,done,total){
  const pct=total?Math.round(done/total*100):0;
  $("importStatus").textContent=label;$("importPercent").textContent=`${pct}%`;
  $("importBar").style.width=`${pct}%`;
}
async function importFiles(files){
  if(!files.length)return;
  $("pdfInput").disabled=true;$("importProgress").classList.remove("hidden");
  let imported=0,invalidTotal=0,failed=0;
  try{
    for(let f=0;f<files.length;f++){
      const file=files[f];
      if(!file.name.toLowerCase().endsWith(".pdf")&&file.type!=="application/pdf"){failed++;continue;}
      try{
        updateProgress(`Opening ${file.name}`,0,1);
        const data=new Uint8Array(await file.arrayBuffer());
        const pdf=await pdfjsLib.getDocument({data, useSystemFonts:true}).promise;
        const lines=[];
        for(let p=1;p<=pdf.numPages;p++){
          const page=await pdf.getPage(p);
          lines.push(...await pageTextLines(page,p));
          updateProgress(`${file.name} · page ${p} of ${pdf.numPages}`,p,pdf.numPages);
        }
        const parsed=parseDocument(lines,file.name);
        if(parsed.questions.length===0){
          failed++;console.warn("No questions detected",file.name,parsed);
          toast(`${file.name}: no questions detected. Existing imported copy was kept.`);
          await pdf.destroy();continue;
        }
        // Only replace an existing same-name import after a non-empty parse.
        await deleteSource(file.name);
        await writeMany("questions",parsed.questions);
        await writeMany("pdfs",[{
          id:file.name,name:file.name,pages:pdf.numPages,count:parsed.questions.length,
          invalid:parsed.invalid.length,updatedAt:Date.now()
        }]);
        imported+=parsed.questions.length;invalidTotal+=parsed.invalid.length;
        console.info(`[PDF Exam Quiz] ${file.name}: ${parsed.questions.length} questions; ${parsed.invalid.length} requiring answer-key review.`);
        if(parsed.invalid.length){
          toast(`${file.name}: ${parsed.questions.length} questions imported; ${parsed.invalid.length} need answer-key review.`,6000);
        }
        await pdf.destroy();
      }catch(err){
        console.error("PDF import failed:",file.name,err);failed++;
        toast(`Could not import ${file.name}: ${err.message||err}`,6000);
      }
    }
    await refreshData();
    const msg=`Imported ${imported} questions. ${invalidTotal} need answer-key review.${failed?` ${failed} file(s) failed.`:""}`;
    updateProgress(msg,1,1);toast(msg,6500);
  }finally{
    $("pdfInput").disabled=false;
    setTimeout(()=>$("importProgress").classList.add("hidden"),7000);
    $("pdfInput").value="";
  }
}
async function refreshData(){
  questions=await all("questions");
  const wrong=await all("wrong");wrongIds=new Set(wrong.map(q=>q.id));
  const pdfs=await all("pdfs");
  $("loadedCount").textContent=questions.length.toLocaleString();
  $("wrongCount").textContent=wrongIds.size.toLocaleString();
  $("pdfCount").textContent=`${pdfs.length} file(s)`;
  $("retryWrong").disabled=!wrongIds.size;$("retryFromResults").disabled=!wrongIds.size;
  $("retryHint").textContent=wrongIds.size?`${wrongIds.size} saved question(s) to practise again.`:"Wrong answers are saved here for later practice.";
  const previous=$("subjectSelect").value;
  $("subjectSelect").innerHTML='<option value="all">All imported PDFs</option>'+pdfs.map(p=>`<option value="${esc(p.name)}">${esc(p.name)} (${p.count})</option>`).join("");
  if(pdfs.some(p=>p.name===previous))$("subjectSelect").value=previous;
  $("libraryList").innerHTML=pdfs.length?pdfs.map(p=>`<div class="library-item"><div><strong>${esc(p.name)}</strong><small>${p.count} questions · ${p.pages} pages${p.invalid?` · <span class="warning">${p.invalid} answer keys need review</span>`:" · 4 options / 1 red answer detected"}</small></div><button class="remove-btn" data-remove="${esc(p.name)}" type="button">Remove</button></div>`).join(""):'<p class="hint">No PDFs imported yet. Choose one or more files above.</p>';
  $("libraryList").querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",()=>removePdf(b.dataset.remove)));
}
async function removePdf(name){
  await deleteSource(name);await removeKey("pdfs",name);await refreshData();toast("PDF and its saved questions removed.");
}
function startQuiz(list,retry=false){
  if(!list.length){toast("Import a PDF first, or check your selected subject.");return;}
  const size=$("questionCount").value;
  let pool=retry?[...list]:(size==="all"?[...list]:shuffle(list).slice(0,Math.min(Number(size),list.length)));
  quiz=shuffle(pool);answered=0;score=0;screen("quizScreen");nextQuestion();
}
function clearTimer(){if(timerHandle)clearInterval(timerHandle);timerHandle=null;}
function setTimer(){
  clearTimer();timeLeft=90;active=true;evaluated=false;updateTimer();
  timerHandle=setInterval(()=>{timeLeft--;updateTimer();if(timeLeft<=0){clearTimer();evaluate(true);}},1000);
}
function updateTimer(){
  $("timer").textContent=`${String(Math.floor(timeLeft/60)).padStart(2,"0")}:${String(timeLeft%60).padStart(2,"0")}`;
  $("timer").classList.toggle("warning",timeLeft<=20);
}
function nextQuestion(){
  clearTimer();
  if(!quiz.length){finishQuiz();return;}
  current=quiz.shift();currentOptions=$("shuffleAnswers").checked?shuffle(current.options):[...current.options];
  selectedIndex=null;evaluated=false;
  $("source").textContent=`${current.source} · PDF page ${current.page}`;
  $("questionNumber").textContent=`QUESTION ${current.number}`;
  $("questionText").textContent=current.question;
  $("progress").textContent=`Question ${answered+1} of ${answered+quiz.length+1}`;
  $("quizProgressBar").style.width=`${(answered/(answered+quiz.length+1))*100}%`;
  $("feedback").textContent="";$("feedback").className="feedback";
  $("answers").innerHTML="";
  currentOptions.forEach((o,i)=>{
    const b=document.createElement("button");b.type="button";b.className="answer-btn";
    b.innerHTML=`<span class="answer-letter">${esc(o.label)}</span><span>${esc(o.text)}</span>`;
    b.addEventListener("click",()=>choose(i));$("answers").appendChild(b);
  });
  $("selectAnswer").disabled=true;$("nextQuestion").classList.add("hidden");$("selectAnswer").classList.remove("hidden");
  setTimer();
}
function choose(i){
  if(!active||evaluated)return;
  selectedIndex=i;
  [...$("answers").children].forEach((b,j)=>b.classList.toggle("selected",j===i));
  $("feedback").textContent="Answer selected. You can change it before pressing Select.";
  $("feedback").className="feedback neutral";$("selectAnswer").disabled=false;
}
async function evaluate(timeout=false){
  if(evaluated)return;
  clearTimer();active=false;evaluated=true;answered++;
  const correctIndexes=currentOptions.map((o,i)=>o.correct?i:-1).filter(i=>i>=0);
  const buttons=[...$("answers").children];buttons.forEach(b=>b.disabled=true);
  if(correctIndexes.length!==1||currentOptions.length!==4){
    $("feedback").textContent="This question was imported, but its answer key did not pass the four-options / one-red-answer check. It has not been scored.";
    $("feedback").className="feedback neutral";
  }else{
    const ci=correctIndexes[0],right=currentOptions[ci];
    if(timeout||selectedIndex===null){
      await saveWrong(current);
      $("feedback").textContent=timeout?`Time is up. Correct answer: ${right.label}. ${right.text}`:`No answer selected. Correct answer: ${right.label}. ${right.text}`;
      $("feedback").className="feedback bad";
    }else if(currentOptions[selectedIndex].correct){
      score++;await removeKey("wrong",current.id);
      buttons[selectedIndex].classList.remove("selected");buttons[selectedIndex].classList.add("correct");
      $("feedback").textContent="✓ Correct answer!";$("feedback").className="feedback good";
    }else{
      await saveWrong(current);
      buttons[selectedIndex].classList.remove("selected");buttons[selectedIndex].classList.add("incorrect");
      buttons[ci].classList.add("correct");
      $("feedback").textContent=`Incorrect. Correct answer: ${right.label}. ${right.text}`;
      $("feedback").className="feedback bad";
    }
  }
  $("selectAnswer").classList.add("hidden");$("nextQuestion").classList.remove("hidden");
  $("nextQuestion").textContent=quiz.length?"Next question →":"See results →";
  await refreshData();
}
async function finishQuiz(){
  clearTimer();active=false;screen("resultsScreen");
  $("resultScore").textContent=`${score} / ${answered}`;
  $("resultPercent").textContent=`${answered?Math.round(score/answered*100):0}% correct · ${answered} questions answered.`;
  const wrong=await all("wrong");
  $("resultWrong").textContent=`${wrong.length} saved mistake(s) available for another attempt.`;
  $("wrongReview").innerHTML=wrong.length?wrong.slice(0,20).map(q=>`<div class="review-item"><strong>${esc(q.question)}</strong><small>${esc(q.source)} · Page ${q.page} · Correct answer: ${esc(q.options.find(o=>o.correct)?.label||"not detected")}</small></div>`).join(""):'<p class="hint">No saved mistakes. Great work!</p>';
  await refreshData();
}
$("pdfInput").addEventListener("change",e=>importFiles([...e.target.files]));
$("startQuiz").addEventListener("click",()=>{
  const source=$("subjectSelect").value;
  startQuiz(questions.filter(q=>source==="all"||q.source===source));
});
$("retryWrong").addEventListener("click",async()=>startQuiz(await all("wrong"),true));
$("retryFromResults").addEventListener("click",async()=>startQuiz(await all("wrong"),true));
$("selectAnswer").addEventListener("click",()=>evaluate(false));
$("nextQuestion").addEventListener("click",nextQuestion);
$("homeBtn").addEventListener("click",()=>{clearTimer();active=false;screen("homeScreen");});
$("backHome").addEventListener("click",()=>screen("homeScreen"));
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").classList.remove("hidden");});
$("installBtn").addEventListener("click",async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").classList.add("hidden");});
async function cachePdfJs(){
  if(!("caches" in window))return;
  try{
    const cache=await caches.open("pdf-exam-quiz-v2");
    for(const url of PDFJS_URLS){
      if(await cache.match(url))continue;
      const response=await fetch(url,{mode:"cors"});
      if(response.ok)await cache.put(url,response);
    }
  }catch(e){console.warn("PDF.js could not be cached for offline use yet.",e);}
}
if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
    try{await navigator.serviceWorker.register("./sw.js");await navigator.serviceWorker.ready;cachePdfJs();}
    catch(e){console.warn("Service worker registration failed",e);}
  });
}
db=await openDB();await refreshData();
