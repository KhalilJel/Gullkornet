# OpenOutSend runtime

This runtime installs OpenOutSend 0.1.39 and applies the required Pydantic AI compatibility repair during image build.

The repair is intentionally versioned in Gullkornet instead of being hidden in a Railway startup command.

Runtime responsibilities:
- persistent /app/data volume
- outsend check on startup
- KeeLead JSONL ingestion at the application boundary
- sending remains controlled by OPENOUTREACH_ALLOW_SEND

No mailbox credentials or API keys belong in this directory.
