"""Smoke-test a locally running staged executable using fictional demo data only."""
from pathlib import Path
import json
import httpx

root = Path(__file__).resolve().parent.parent
with httpx.Client(base_url='http://127.0.0.1:8772', headers={'X-Workspace':'demo'}, timeout=30) as client:
    health=client.get('/api/health').json()
    assert health['version']=='0.2.0',health
    html=client.get('/').text
    assert 'index-BW3Vp1US.js' in html
    docs=client.get('/api/library/documents').json()
    assert len(docs)==3
    page=client.get(f"/api/library/documents/{docs[0]['id']}/pages/1/image?workspace=demo")
    assert page.status_code==200 and page.content.startswith(b'\x89PNG')
    bootstrap=client.get('/api/bootstrap').json()
    student=next(s for s in bootstrap['students'] if s['grade']=='七年级')
    rec=client.get(f"/api/students/{student['id']}/recommendations").json()
    assert rec['available']==4 and rec['shortage']==4
    result=client.post(f"/api/students/{student['id']}/practice-sets",json={'title':'可执行包验收·虚构练习','question_ids':[rec['items'][0]['question']['id']]} )
    result.raise_for_status()
    saved=result.json()
    exam=client.post(f"/api/practice-sets/{saved['id']}/to-exam",json={}).json()
    assert exam['questions'][0]['student_answer']=='' and exam['school_score'] is None
    assert len(exam['question_sources'])==1
    source=next(iter(exam['question_sources'].values()))
    assert client.get(source['url']).status_code==200
    personal=client.get('/api/bootstrap',headers={'X-Workspace':'personal'}).json()
    assert personal['stats']['students']==0
    assert client.get('/api/library/documents',headers={'X-Workspace':'personal'}).json()==[]
    receipt={'version':health['version'],'frontend':'index-BW3Vp1US.js','demo_documents':len(docs),'matched':rec['available'],'shortage':rec['shortage'],'blank_practice_created':True,'source_page_available':True,'personal_empty':True,'actual_provider_called':False,'exam_id':exam['id'],'practice_id':saved['id']}
    (root/'runtime/v02-portable-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False,indent=2))
