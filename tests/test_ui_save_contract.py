"""UI save actions must not need partially committed follow-up requests."""
from test_api_acceptance import PERSONAL, ok, student


def test_new_manual_plan_saves_followup_in_one_request(client):
    pupil = student(client, "UI原子保存虚构学生")
    payload = {"title": "UI复核教案", "content": "虚构教学安排", "lesson_note": "实际复测记录（虚构）",
               "review_date": "2026-10-12", "review_result": "2题待巩固（虚构）"}
    plan = ok(client.post(f"/api/students/{pupil['id']}/plans/manual", headers=PERSONAL, json=payload))
    for key, value in payload.items():
        assert plan[key] == value
    detail = ok(client.get(f"/api/students/{pupil['id']}", headers=PERSONAL))
    assert len(detail['plans']) == 1
    assert detail['plans'][0]['review_result'] == payload['review_result']


def test_invalid_followup_does_not_leave_partial_manual_plan(client):
    pupil = student(client, "UI无半成品虚构学生")
    response = client.post(f"/api/students/{pupil['id']}/plans/manual", headers=PERSONAL,
                           json={"title": "必须整体校验", "content": "虚构内容", "review_date": "not-a-date"})
    assert response.status_code == 422
    assert ok(client.get(f"/api/students/{pupil['id']}", headers=PERSONAL))['plans'] == []
