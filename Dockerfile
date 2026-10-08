FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV OUTSEND_HOME=/app/data

WORKDIR /app

RUN pip install --no-cache-dir openoutsend==0.1.39
COPY openoutsend_resend.py /usr/local/lib/python3.13/site-packages/openoutsend_resend.py

RUN python -c "from pathlib import Path; p=Path('/usr/local/lib/python3.13/site-packages/cold_outreach/core/llm.py'); s=p.read_text(); p.write_text(s.replace('OpenAIModel','OpenAIChatModel'))" \
 && python -c "from cold_outreach.core.llm import build_llm_model; print(type(build_llm_model('openai_compatible:inception/mercury-2.5','test','http://invalid')).__name__)" \
 && python -c "from pathlib import Path; p=Path('/usr/local/lib/python3.13/site-packages/cold_outreach/emails/smtp.py'); s=p.read_text(); s=s.replace('import smtplib\\nimport ssl\\n','import os\\nimport smtplib\\nimport ssl\\n'); s=s.replace('    context = ssl.create_default_context()\\n    try:\\n','    if (os.environ.get(\"OUTSEND_MAIL_TRANSPORT\") or \"smtp\").strip().lower() == \"resend\":\\n        from openoutsend_resend import verify_sender\\n        return verify_sender(username)\\n\\n    context = ssl.create_default_context()\\n    try:\\n'); p.write_text(s)" \
 && python -c "from pathlib import Path; p=Path('/usr/local/lib/python3.13/site-packages/cold_outreach/emails/sender.py'); s=p.read_text(); marker='    from cold_outreach.emails.delivery_policy import record_acceptance, record_failure\\n\\n    try:\\n'; replacement='    if (os.environ.get(\"OUTSEND_MAIL_TRANSPORT\") or \"smtp\").strip().lower() == \"resend\":\\n        from openoutsend_resend import deliver\\n        from cold_outreach.emails.delivery_policy import record_acceptance, record_failure\\n        try:\\n            status, response = deliver(email_message)\\n            record_acceptance(row, status, response)\\n        except Exception as exc:\\n            record_failure(row, exc)\\n            raise\\n        return\\n\\n'+marker; s=s.replace('import logging\\nimport smtplib\\n','import logging\\nimport os\\nimport smtplib\\n'); s=s.replace(marker,replacement,1); p.write_text(s)" \
 && python -c "from pathlib import Path; p=Path('/usr/local/lib/python3.13/site-packages/cold_outreach/first_run.py'); s=p.read_text(); s=s.replace('import logging\\nimport os\\n','import logging\\nimport os\\n'); marker='    if missing:\\n        raise OutsendError(f\"not ready to send — set {\', \'.join(missing)}\")\\n'; replacement=marker+'\\n    if (os.environ.get(\"OUTSEND_MAIL_TRANSPORT\") or \"smtp\").strip().lower() == \"resend\":\\n        from cold_outreach.emails.models import Mailbox\\n        from openoutsend_resend import verify_sender\\n        mailbox = Mailbox.objects.order_by(\"pk\").first()\\n        if mailbox is None:\\n            raise OutsendError(\"Resend transport selected but no mailbox is configured\")\\n        ok, reason = verify_sender(mailbox.from_address)\\n        if not ok:\\n            raise OutsendError(f\"Resend transport check failed: {reason}\")\\n'; s=s.replace(marker,replacement,1); p.write_text(s)" \
 && OUTSEND_MAIL_TRANSPORT=resend python -c "import openoutsend_resend; print('RESEND_TRANSPORT_MODULE=ok')" \
 && OUTSEND_MAIL_TRANSPORT=smtp python -c "from cold_outreach.emails.smtp import verify_auth; print('SMTP_PATH=ok')" \
 && python -c "from cold_outreach.emails.sender import send_email; print('SENDER_PATCH=ok')"

CMD ["outsend", "check"]
