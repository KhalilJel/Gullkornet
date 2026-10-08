"""Runtime hook for the Cidea OpenOutSend Resend transport."""
try:
    from openoutsend_resend import install
    install()
except Exception:
    # Do not hide ordinary Python startup errors. The selected transport will surface
    # its own configuration/connection error when OpenOutSend runs.
    raise
