export interface LibraryFile {id:string;filename:string;mime:string;size:number;page_start:number;page_count:number;url:string}
export interface LibraryDocument {id:string;kind:'textbook'|'past_paper';title:string;grade:string;edition:string;term:string;unit:string;year:string;region:string;notes:string;revision:number;created_at:string;page_count:number;text_page_count:number;size:number;files:LibraryFile[];question_count:number;confirmed_question_count:number}
export interface LibraryPage {page:number;text_excerpt:string;has_text:boolean;preview_url:string}
export interface BankQuestion {id:string;document_id:string;source_page:number;source_end_page:number;number:string;context:string;stem:string;options:string[];answer:string;explanation:string;knowledge_tags:string[];difficulty:'easy'|'medium'|'hard';max_score:number;status:'draft'|'confirmed';revision:number;created_at:string}
export interface SearchHit {document_id:string;title:string;page:number;snippet:string;preview_url:string}
export interface RecommendedQuestion {question:BankQuestion;document:LibraryDocument;matched_tags:string[];evidence:string[];reason:string}
export interface Recommendations {student_id:string;weak_points:{tag:string;count:number;evidence:string[]}[];items:RecommendedQuestion[];requested:number;available:number;shortage:number;message:string}
export interface PracticeItem {bank_question_id:string;question:BankQuestion;document_title:string;document_kind:string;grade:string;source_url:string;matched_tags:string[];evidence:string[];reason:string}
export interface PracticeSet {id:string;student_id:string;title:string;created_at:string;items:PracticeItem[];linked_exam_id:string|null;linked_exam:import('./types').ExamSummary|null}
export interface LibraryJob {id:string;status:'queued'|'running'|'succeeded'|'failed';kind:string;message:string;result:{document_id?:string;added?:number;skipped?:number}|null}
export type ModuleState={dirty:boolean;busy:boolean};
export const difficultyLabels={easy:'基础',medium:'巩固',hard:'拓展'};
export const materialKinds={textbook:'教材',past_paper:'真题 / 试卷'};
export const blankBankQuestion=(documentId:string,page:number):BankQuestion=>({id:'',document_id:documentId,source_page:page,source_end_page:page,number:'',context:'',stem:'',options:[],answer:'',explanation:'',knowledge_tags:[],difficulty:'medium',max_score:1,status:'draft',revision:0,created_at:''});
