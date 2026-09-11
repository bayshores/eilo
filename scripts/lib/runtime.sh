# Shared environment for project-owned runtime launchers. Source after EILO_ROOT
# is resolved; never inherit a global Hermes profile or change a user's shell.
: "${EILO_ROOT:?The launcher must resolve EILO_ROOT first}"
umask 077

if [ -n "${EILO_RUNTIME_HOME:-}" ]; then
  EILO_PYTHON="$EILO_RUNTIME_HOME/run-python"
else
  EILO_PYTHON="$EILO_ROOT/.runtime/venv/bin/python"
fi
if [ ! -x "$EILO_PYTHON" ]; then
  printf '%s\n' 'The project-local Hermes runtime is missing. See docs/development.md.' >&2
  exit 1
fi

EILO_DATA_HOME="${EILO_DATA_HOME:-$EILO_ROOT/.state}"
EILO_CACHE_HOME="${EILO_CACHE_HOME:-$EILO_ROOT/.tmp/cache}"
export HERMES_HOME="$EILO_DATA_HOME/hermes"
export EILO_WORKSPACE_HOME="$EILO_DATA_HOME/workspace"
export TMPDIR="$EILO_CACHE_HOME/tmp"
export UV_CACHE_DIR="$EILO_CACHE_HOME/uv-cache"
export XDG_CACHE_HOME="$EILO_CACHE_HOME"
export PYTHONDONTWRITEBYTECODE=1
export GIT_CEILING_DIRECTORIES="$EILO_ROOT"
mkdir -p "$HERMES_HOME" "$TMPDIR" "$XDG_CACHE_HOME" "$EILO_WORKSPACE_HOME"

eilo_initialize_profile() {
  # Existing private configuration is authoritative and is never overwritten.
  if [ ! -f "$HERMES_HOME/config.yaml" ]; then
    cp "$EILO_ROOT/config/hermes.yaml" "$HERMES_HOME/config.yaml"
  fi
  if [ ! -f "$HERMES_HOME/.env" ]; then
    cp "$EILO_ROOT/config/hermes.env.example" "$HERMES_HOME/.env"
  fi
}
