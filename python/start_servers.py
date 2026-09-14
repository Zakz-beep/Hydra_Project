"""Launch the registered APIs, optionally with Next.js. No third-party launcher dependencies."""
from __future__ import annotations
import argparse
from dataclasses import dataclass
from pathlib import Path
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PYTHON_DIR = ROOT / 'python'
# Keep the unauthenticated REPL (8011) excluded. It is not an application backend.
apis = [('.', 'vrp_api3:app', 8000), ('.', 'greeks_api:app', 8001), ('.', 'risk_api:app', 8002),
        ('.', 'regime_api:app', 8007), ('volatality', 'api:app', 8006), ('correlaction', 'api:app', 8004),
        ('.', 'cot_api:app', 8008), ('dispersion', 'api:app', 8009), ('.', 'hrp_api:app', 8010),
        ('.', 'beta_api:app', 8012), ('crypto', 'api:app', 8013), ('onchain', 'api:app', 8014), ('.', 'macro_api:app', 8015), ('.', 'agent_hub_api:app', 8016)]
NAMES = ['vrp', 'greeks', 'risk', 'regime', 'volatility', 'correlation', 'cot', 'dispersion', 'hrp', 'beta', 'crypto', 'onchain', 'macro', 'agenthub']

@dataclass(frozen=True)
class Service:
    name: str
    port: int
    cwd: Path
    command: list[str]
    path: str = '/openapi.json'


def is_port_in_use(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(.2)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def service_ready(service: Service) -> bool:
    try:
        # Never send localhost probes through an environment proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{service.port}{service.path}', timeout=.4) as response:
            data = response.read(1_000_000)
            if service.name == 'next':
                return response.status == 200 and b'_next/' in data
            return response.status == 200 and bool(json.loads(data).get('openapi'))
    except (OSError, ValueError):
        return False


def build_services(args) -> list[Service]:
    wanted = set(args.only.split(',')) if args.only else None
    valid = set(NAMES + ['next'])
    if wanted and not wanted <= valid:
        raise ValueError('Unknown service: ' + ', '.join(sorted(wanted - valid)))
    result: list[Service] = []
    if not args.frontend_only and (not wanted or wanted & set(NAMES)):
        python = Path(args.python).resolve() if args.python else PYTHON_DIR / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        if not python.is_file():
            raise ValueError(f'Python environment missing: {python}. Run uv venv python/.venv then uv pip install --python "{python}" -r python/requirements.txt')
        uv = shutil.which('uv')
        if not uv:
            raise ValueError('uv is not on PATH. Install uv or open a terminal where uv is available.')
        for name, (folder, module, port) in zip(NAMES, apis):
            if wanted and name not in wanted:
                continue
            cwd = PYTHON_DIR / folder
            if not (cwd / (module.split(':')[0] + '.py')).is_file():
                raise ValueError(f'Missing API source: {cwd / module}')
            command = [uv, 'run', '--no-project', '--no-python-downloads', '--python', str(python), '-m', 'uvicorn', module,
                       '--host', '127.0.0.1' if name=='agenthub' else args.host, '--port', str(port), '--timeout-keep-alive', '65']
            if not args.no_reload:
                command.append('--reload')
            result.append(Service(name, port, cwd, command))
    if not args.backend_only and (not wanted or 'next' in wanted):
        node = shutil.which('node')
        frontend = ROOT / 'vrp-claude'
        cli = frontend / 'node_modules/next/dist/bin/next'
        if not node or not cli.is_file():
            raise ValueError('Node.js or Next.js dependencies are missing. Install Node.js and run npm install in vrp-claude.')
        if args.production and not (frontend / '.next/BUILD_ID').is_file():
            raise ValueError('Production build missing. Run npm run build in vrp-claude first.')
        result.append(Service('next', args.port, frontend, [node, str(cli), 'start' if args.production else 'dev', '-H', args.host, '-p', str(args.port)], '/'))
    if not result:
        raise ValueError('No services selected. Check --only / --frontend-only / --backend-only.')
    return result


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == 'nt':
        # The supervisor owns this PID; /T also stops uvicorn reload/Next workers.
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, check=False,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=5)


def main(include_frontend: bool = False) -> int:
    parser = argparse.ArgumentParser(description='VRP Dashboard service supervisor. Ctrl+C stops only processes started by this launcher.')
    parser.add_argument('--host', default='127.0.0.1', help='Bind address; default localhost')
    parser.add_argument('--port', type=int, default=3000, help='Next.js port')
    parser.add_argument('--python', help='Backend Python executable (default python/.venv)')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--backend-only', action='store_true', default=not include_frontend)
    modes.add_argument('--frontend-only', action='store_true')
    parser.add_argument('--with-frontend', action='store_true', help='Also start Next.js from the backend entry point')
    parser.add_argument('--only', help='Comma-separated service names: ' + ','.join(NAMES + ['next']))
    parser.add_argument('--no-reload', action='store_true', help='Disable Python reload workers')
    parser.add_argument('--production', action='store_true', help='Use Next.js production build and disable Python reload')
    parser.add_argument('--check', action='store_true', help='Validate executables/source paths and show the plan without starting anything')
    parser.add_argument('--startup-timeout', type=float, default=180, help='Seconds before reporting a startup timeout')
    parser.add_argument('--log-dir', type=Path, default=ROOT / '.ua' / 'servers')
    args = parser.parse_args()
    if args.with_frontend or args.frontend_only:
        args.backend_only = False
    if args.production:
        args.no_reload = True
    if not 1 <= args.port <= 65535 or args.startup_timeout <= 0:
        parser.error('Invalid port or startup timeout')
    try:
        services = build_services(args)
    except ValueError as error:
        print(f'[ERROR] {error}', flush=True)
        return 2
    print('\nVRP DASHBOARD | SERVICE LAUNCHER', flush=True)
    for service in services:
        print(f'  {service.name:12} :{service.port:<5} {"occupied (will not restart)" if is_port_in_use(service.port) else "available"}', flush=True)
    if args.check:
        print('\n[CHECK] Paths/executables OK. Runtime imports and readiness are checked on actual startup.', flush=True)
        return 0
    args.log_dir.mkdir(parents=True, exist_ok=True)
    managed: dict[str, tuple[Service, subprocess.Popen, object]] = {}
    statuses: dict[str, str] = {}
    started = time.monotonic()
    exit_code = 0
    def on_stop(_sig, _frame):
        raise KeyboardInterrupt
    prior_sigterm = signal.signal(signal.SIGTERM, on_stop)
    try:
        for service in services:
            if is_port_in_use(service.port):
                statuses[service.name] = 'EXISTING' if service_ready(service) else 'PORT CONFLICT / UNVERIFIED'
                if statuses[service.name] != 'EXISTING':
                    exit_code = 1
                print(f'[{statuses[service.name]}] {service.name} :{service.port} (not managed)', flush=True)
                continue
            log = (args.log_dir / f'{service.name}.log').open('a', encoding='utf-8')
            log.write(f'\n--- Launch {time.strftime("%Y-%m-%d %H:%M:%S")} ---\n'); log.flush()
            options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
            env = {**os.environ, 'PYTHONUNBUFFERED': '1', 'PYTHONIOENCODING': 'utf-8'}
            try:
                process = subprocess.Popen(service.command, cwd=service.cwd, stdout=log, stderr=subprocess.STDOUT, env=env, **options)
            except OSError as error:
                log.close(); statuses[service.name] = 'FAILED'; exit_code = 1
                print(f'[FAILED] {service.name}: {error}', flush=True)
                continue
            managed[service.name] = (service, process, log)
            statuses[service.name] = 'STARTING'
            print(f'[STARTING] {service.name} :{service.port} -> {args.log_dir / (service.name + ".log")}', flush=True)
        print("\nCtrl+C stops this launcher's services; pre-existing servers are left running.", flush=True)
        announced = False
        while managed:
            for name, (service, process, log) in list(managed.items()):
                if process.poll() is not None:
                    if statuses[name] != 'FAILED':
                        statuses[name] = 'FAILED'; exit_code = 1
                        print(f'[FAILED] {name} exited ({process.returncode}). Read {args.log_dir / (name + ".log")}', flush=True)
                    continue
                if statuses[name] == 'STARTING':
                    if service_ready(service):
                        statuses[name] = 'READY'; print(f'[READY] {name} http://127.0.0.1:{service.port}', flush=True)
                    elif time.monotonic() - started > args.startup_timeout:
                        statuses[name] = 'TIMEOUT'; exit_code = 1
                        print(f'[TIMEOUT] {name}: no HTTP readiness yet; process retained for diagnostics. See its log.', flush=True)
            if not announced and 'STARTING' not in statuses.values():
                ready = sum(v in ('READY', 'EXISTING') for v in statuses.values())
                print(f'\n[SUMMARY] {ready}/{len(services)} services responding; logs: {args.log_dir}', flush=True)
                announced = True
            if all(p.poll() is not None for _, p, _ in managed.values()):
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print('\n[STOP] Shutting down owned process trees...', flush=True)
    finally:
        for _, process, log in reversed(list(managed.values())):
            stop_process(process); log.close()
        signal.signal(signal.SIGTERM, prior_sigterm)
    if not managed:
        print('[DONE] No new processes were started.', flush=True)
    else:
        print('[DONE] Owned services stopped.', flush=True)
    return exit_code

if __name__ == '__main__':
    raise SystemExit(main())
