from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class StudentCreate(Model):
    name: str = Field(min_length=1, max_length=100)
    grade: str = Field(default="", max_length=100)
    school: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=10000)
    target_score: float | None = Field(default=None, ge=0, le=10000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("姓名不能为空")
        return value.strip()


class StudentPatch(Model):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    grade: str | None = Field(default=None, max_length=100)
    school: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=10000)
    target_score: float | None = Field(default=None, ge=0, le=10000)


class Question(Model):
    id: str = Field(default="", max_length=100)
    number: str = Field(default="", max_length=100)
    stem: str = Field(default="", max_length=400000)
    student_answer: str = Field(default="", max_length=30000)
    correct_answer: str = Field(default="", max_length=30000)
    school_score: float | None = Field(default=None, ge=0)
    max_score: float = Field(default=0, ge=0, le=10000)
    ai_score: float | None = Field(default=None, ge=0)
    knowledge_tag: str = Field(default="", max_length=1000)
    error_reason: str = Field(default="", max_length=10000)
    teacher_note: str = Field(default="", max_length=10000)
    needs_review: bool = True
    reviewed: bool = False
    source_page: int = Field(default=1, ge=1, le=10000)
    source_attachment_id: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def valid_scores(self):
        for name in ("school_score", "ai_score"):
            score = getattr(self, name)
            if score is not None and score > self.max_score:
                raise ValueError(f"{name} 不能高于本题满分")
        return self


class ExamCreate(Model):
    title: str = Field(min_length=1, max_length=200)
    exam_date: date
    kind: Literal["school", "practice"] = "school"
    full_score: float = Field(default=100, gt=0, le=10000)
    school_score: float | None = Field(default=None, ge=0)
    notes: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def valid_total(self):
        if not self.title.strip():
            raise ValueError("试卷标题不能为空")
        if self.school_score is not None and self.school_score > self.full_score:
            raise ValueError("学校成绩不能高于试卷满分")
        return self


class ExamSave(ExamCreate):
    revision: int = Field(ge=1)
    questions: list[Question] = Field(default_factory=list, max_length=300)


class Confirm(Model):
    revision: int = Field(ge=1)


class PlanRequest(Model):
    exam_id: str | None = None


class ManualPlan(PlanRequest):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=100000)
    lesson_note: str = Field(default="", max_length=30000)
    review_date: date | None = None
    review_result: str = Field(default="", max_length=30000)


class PlanPatch(Model):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=100000)
    lesson_note: str | None = Field(default=None, max_length=30000)
    review_date: date | None = None
    review_result: str | None = Field(default=None, max_length=30000)


class SettingsInput(Model):
    base_url: str = Field(default="https://api.deepseek.com", max_length=1000)
    model: str = Field(default="deepseek-flash", max_length=200)
    vision_model: str = Field(default="deepseek-flash", max_length=200)
    api_key: str | None = Field(default=None, max_length=10000)
    clear_api_key: bool = False
    timeout_seconds: int = Field(default=90, ge=10, le=300)
