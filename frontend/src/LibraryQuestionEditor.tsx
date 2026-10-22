import { useId } from 'react';
import { ArrowUp, CheckCheck, FileText, LoaderCircle, Save, ShieldCheck } from 'lucide-react';
import { Action, InputField } from './library-ui';
import { difficultyLabels, type BankQuestion } from './library-types';

export function questionFieldErrors(q:BankQuestion,pageCount:number){
 return {
  number: !q.number.trim()?'请填写原题题号；无题号时可填写自定编号。':q.number.length>100?'题号最多 100 个字符。':'',
  source_page: !Number.isInteger(q.source_page)||q.source_page<1||q.source_page>pageCount?`起始页须为 1–${pageCount} 的整数。`:'',
  source_end_page: !Number.isInteger(q.source_end_page)||q.source_end_page<1||q.source_end_page>pageCount?`结束页须为 1–${pageCount} 的整数。`:q.source_end_page<q.source_page?'结束页不能早于起始页。':'',
  max_score: !Number.isFinite(q.max_score)||q.max_score<=0||q.max_score>10000?'满分须大于 0 且不超过 10000，可填写小数。':''
 };
}

export default function LibraryQuestionEditor({question:q,pageCount,busy,dirty,error,onChange,onSave,onConfirm,onSource,onList}:{question:BankQuestion;pageCount:number;busy:string;dirty:boolean;error?:string;onChange:(q:BankQuestion)=>void;onSave:()=>void;onConfirm:()=>void;onSource:(page:number)=>void;onList:()=>void}){
 const update=(patch:Partial<BankQuestion>)=>onChange({...q,...patch});
 const uid=useId(),errors=questionFieldErrors(q,pageCount),valid=Object.values(errors).every(value=>!value);
 const missing=[!q.stem.trim()&&'题干',!q.answer.trim()&&'正确答案',!q.knowledge_tags.some(tag=>tag.trim())&&'知识点'].filter(Boolean);
 const ready=valid&&!missing.length,confirmed=q.status==='confirmed'&&!dirty;
 const feedback=(field:keyof typeof errors)=>errors[field]?<small id={`${uid}-${field}`} className="field-error">{errors[field]}</small>:null;
 const validation=(field:keyof typeof errors)=>({'aria-invalid':!!errors[field],'aria-describedby':errors[field]?`${uid}-${field}`:undefined});
 return <section className="bank-editor panel" aria-busy={!!busy}>
  <div className="section-top"><div><h2>{q.id?`题目校对${q.number?` · 第 ${q.number} 题`:''}`:'手工录入题目'}</h2><p>先保存草稿，校对完整后再确认入库。</p></div><span className={`bank-status ${dirty?'draft':q.status}`}>{dirty?'未保存':confirmed?'已确认入库':'待校对草稿'}</span></div>
  <Action variant="text" className="editor-list-link" icon={<ArrowUp size={15}/>} onClick={onList}>返回题目列表</Action>
  <fieldset disabled={!!busy} className="form-fieldset">
   <div className="form-grid bank-source-fields">
    <InputField label="原题题号 *"><input value={q.number} maxLength={100} placeholder="例如：21 或 自编1" onChange={e=>update({number:e.target.value})} {...validation('number')}/>{feedback('number')}</InputField>
    <InputField label="难度"><select value={q.difficulty} onChange={e=>update({difficulty:e.target.value as BankQuestion['difficulty']})}>{Object.entries(difficultyLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></InputField>
    <InputField label="来源起始页 *"><input type="number" min="1" max={pageCount} step="1" value={q.source_page||''} onChange={e=>update({source_page:Number(e.target.value)})} {...validation('source_page')}/>{feedback('source_page')}</InputField>
    <InputField label="来源结束页 *"><input type="number" min={Math.max(1,q.source_page)} max={pageCount} step="1" value={q.source_end_page||''} onChange={e=>update({source_end_page:Number(e.target.value)})} {...validation('source_end_page')}/>{feedback('source_end_page')}</InputField>
   </div>
   <InputField label="共享材料 / 阅读全文" hint="阅读文章、对话或听力原文保存在这里。多道小题共用的材料也要完整保留。"><textarea rows={5} value={q.context} placeholder="完整阅读材料（如有）" onChange={e=>update({context:e.target.value})}/></InputField>
   <InputField label="题干 *"><textarea rows={3} value={q.stem} placeholder="保留题目的完整要求，不包含学生原答案" onChange={e=>update({stem:e.target.value})}/></InputField>
   <InputField label="选项" hint="每行一个选项，保留 A. / B. 等标号；非选择题可留空。"><textarea rows={4} value={q.options.join('\n')} placeholder={'A. ...\nB. ...\nC. ...\nD. ...'} onChange={e=>update({options:e.target.value.split('\n')})}/></InputField>
   <div className="form-grid"><InputField label="正确答案 *"><textarea rows={2} value={q.answer} onChange={e=>update({answer:e.target.value})}/></InputField><InputField label="本题满分 *"><input type="number" min="0" max="10000" step="any" value={q.max_score||''} onChange={e=>update({max_score:Number(e.target.value)})} {...validation('max_score')}/>{feedback('max_score')}</InputField></div>
   <InputField label="答案解析"><textarea rows={3} value={q.explanation} placeholder="填写可核验的解析与解题依据" onChange={e=>update({explanation:e.target.value})}/></InputField>
   <InputField label="知识点 *" hint="多个知识点用逗号分隔。使用清晰、一致的名称能帮助之后匹配题目。"><input value={q.knowledge_tags.join('，')} placeholder="例如：一般过去时，动词时态" onChange={e=>update({knowledge_tags:e.target.value.split(/[,，;；]/)})}/></InputField>
   <div className="bank-editor-notice"><ShieldCheck size={16}/><span>AI 拆题只产生草稿。请核对材料、选项、答案及来源后再确认。草稿允许暂缺题干、答案和知识点。</span></div>
   <div className="bank-editor-actionbar">
    {error&&<p className="field-error" role="alert">{error}</p>}
    <p className="editor-validation" id={`${uid}-readiness`} role="status">{busy==='save'?'正在保存草稿，请稍候…':busy==='confirm'?'正在确认入库，请稍候…':!valid?'请先修正上方标出的题号、页码或分值。':confirmed?'已确认入库，可用于针对性选题。':missing.length?`确认入库前还需填写：${missing.join('、')}。可以先保存草稿。`:'内容已齐全，核对无误后可确认入库。'}</p>
    <div className="bank-editor-actions">
     <Action variant="text" icon={<FileText size={15}/>} onClick={()=>onSource(q.source_page)} disabled={!!errors.source_page}>查看原页</Action>
     <Action variant="secondary" icon={busy==='save'?<LoaderCircle size={16} className="spin"/>:<Save size={16}/>} onClick={onSave} disabled={!valid||(!dirty&&!!q.id)} aria-describedby={`${uid}-readiness`}>{busy==='save'?'正在保存…':'保存草稿'}</Action>
     <Action icon={busy==='confirm'?<LoaderCircle size={16} className="spin"/>:<CheckCheck size={16}/>} onClick={onConfirm} disabled={!ready||confirmed} aria-describedby={`${uid}-readiness`}>{busy==='confirm'?'正在确认…':'确认入库'}</Action>
    </div>
   </div>
  </fieldset>
 </section>;
}
