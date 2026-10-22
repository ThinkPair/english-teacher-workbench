from typing import Literal

from pydantic import Field, model_validator

from .schemas import Model


class DocumentMetadata(Model):
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["textbook", "past_paper"]
    grade: str = Field(default="", max_length=100)
    edition: str = Field(default="", max_length=100)
    term: str = Field(default="", max_length=100)
    unit: str = Field(default="", max_length=100)
    year: str = Field(default="", max_length=100)
    region: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def not_blank(self):
        if not self.title.strip():
            raise ValueError("title is blank")
        self.title = self.title.strip()
        return self


class DocumentPatch(Model):
    revision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    kind: Literal["textbook", "past_paper"] | None = None
    grade: str | None = Field(default=None, max_length=100)
    edition: str | None = Field(default=None, max_length=100)
    term: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=100)
    year: str | None = Field(default=None, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=10000)


class BankFields(Model):
    source_page: int = Field(ge=1, le=500)
    source_end_page: int | None = Field(default=None, ge=1, le=500)
    number: str = Field(min_length=1, max_length=100)
    context: str = Field(default="", max_length=60000)
    stem: str = Field(default="", max_length=30000)
    options: list[str] = Field(default_factory=list, max_length=30)
    answer: str = Field(default="", max_length=10000)
    explanation: str = Field(default="", max_length=20000)
    knowledge_tags: list[str] = Field(default_factory=list, max_length=30)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    max_score: float = Field(default=1, gt=0, le=10000)

    @model_validator(mode="after")
    def source_range(self):
        if self.source_end_page is None:
            self.source_end_page = self.source_page
        if self.source_end_page < self.source_page:
            raise ValueError("invalid page range")
        if not self.number.strip():
            raise ValueError("blank question number")
        self.number = self.number.strip()
        self.knowledge_tags = list(dict.fromkeys(t.strip() for t in self.knowledge_tags if t.strip()))
        if any(len(t) > 200 for t in self.knowledge_tags) or any(len(o) > 10000 for o in self.options):
            raise ValueError("oversized options or tags")
        return self


class BankCreate(BankFields):
    document_id: str


class BankSave(BankFields):
    revision: int = Field(ge=1)


class ExtractRequest(Model):
    revision: int = Field(ge=1)
    pages: list[int] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def unique_pages(self):
        if len(set(self.pages)) != len(self.pages) or any(p < 1 or p > 500 for p in self.pages):
            raise ValueError("pages must be unique and valid")
        return self


class PracticeCreate(Model):
    title: str = Field(min_length=1, max_length=200)
    question_ids: list[str] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def valid(self):
        if not self.title.strip() or len(set(self.question_ids)) != len(self.question_ids):
            raise ValueError("blank title or duplicate questions")
        self.title = self.title.strip()
        return self
