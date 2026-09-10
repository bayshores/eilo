# Shared environment for project-owned runtime launchers. Source after EILO_ROOT
# is resolved; never inherit a global Hermes profile or change a user's shell.
: "${EILO_ROOT:?The launcher must resolve EILO_ROOT first}"
umask 077

EILO_PYTHON="$EILO_ROOT/.runtime/venv/bin/python"
if [ ! -x "$EILO_PYTHON" ]; then
  printf '%s\n' 'The project-local Hermes runtime is missing. See docs/development.md.' >&2
  exit 1
fi

export HERMES_HOME="$EILO_ROOT/.state/hermes"
export TMPDIR="$EILO_ROOT/.tmp"
export UV_CACHE_DIR="$EILO_ROOT/.tmp/uv-cache"
export XDG_CACHE_HOME="$EILO_ROOT/.tmp/cache"
export PYTHONDONTWRITEBYTECODE=1
export GIT_CEILING_DIRECTORIES="$EILO_ROOT"
mkdir -p "$HERMES_HOME" "$TMPDIR" "$XDG_CACHE_HOME" "$EILO_ROOT/.state/workspace"

eilo_initialize_profile() {
  # Existing private configuration is authoritative and is never overwritten.
  if [ ! -f "$HERMES_HOME/config.yaml" ]; then
    cp "$EILO_ROOT/config/hermes.yaml" "$HERMES_HOME/config.yaml"
  fi
  if [ ! -f "$HERMES_HOME/.env" ]; then
    cp "$EILO_ROOT/config/hermes.env.example" "$HERMES_HOME/.env"
  fi
}
