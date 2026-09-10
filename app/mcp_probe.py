"""Explicit connection probe only. No inference or MCP tool execution."""
import contextlib,json,os,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
os.environ['HERMES_HOME']=str(root/'.state/hermes')
from app.connections import validate_mcp

def main():
    source=Path(sys.argv[1])
    if source.stat().st_size>24000:return 2
    value=json.loads(source.read_text())
    draft=validate_mcp({k:value[k] for k in ('name','transport','url','command','args') if k in value})
    config={k:draft[k] for k in ('url','command','args') if k in draft}
    output=sys.stdout
    try:
        with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
            from hermes_cli.mcp_config import _probe_single_server
            tools=_probe_single_server('eilo_probe',config,connect_timeout=12)
        result={'ok':True,'tool_count':len(tools)}
    except Exception:result={'ok':False,'tool_count':None}
    output.write(json.dumps(result)+'\n');return 0
if __name__=='__main__':raise SystemExit(main())
