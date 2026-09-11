"""Keep the pinned runtime inside eïlo's independently authorized account."""


def isolate_account():
    # The upstream runtime can recover expired credentials from Codex CLI. That
    # is inappropriate for a standalone app, even when both run as one Mac user.
    from hermes_cli import auth, auth_codex

    def no_import(*_args, **_kwargs):
        return None

    for module in (auth, auth_codex):
        module._import_codex_cli_tokens = no_import
        module._recover_codex_tokens_from_cli = no_import
