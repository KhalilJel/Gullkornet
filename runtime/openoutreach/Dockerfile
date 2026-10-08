FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OUTSEND_HOME=/app/data

WORKDIR /app

RUN pip install --no-cache-dir openoutsend==0.1.39

# OpenOutSend 0.1.39 imports the pre-2.x Pydantic AI OpenAIModel name.
# Current pydantic-ai-slim exposes OpenAIChatModel instead.
RUN python -c "from pathlib import Path; p=Path('/usr/local/lib/python3.13/site-packages/cold_outreach/core/llm.py'); s=p.read_text(); p.write_text(s.replace('OpenAIModel','OpenAIChatModel'))" \
 && python -c "from cold_outreach.core.llm import build_llm_model; print(type(build_llm_model('inception/mercury-2.5','test','http://invalid')).__name__)"

CMD ["outsend", "check"]
