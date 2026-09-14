"""Launcher tests use harmless temporary child processes, never application servers."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from python.start_servers import NAMES, apis, build_services, is_port_in_use, stop_process

class LauncherTests(unittest.TestCase):
    def args(self, **kwargs):
        result = dict(only=None, frontend_only=False, backend_only=False, python=None, host='127.0.0.1', no_reload=True, production=False, port=3000)
        result.update(kwargs)
        return SimpleNamespace(**result)

    def test_registry_is_unique_and_excludes_repl(self):
        self.assertEqual(len(apis), 14)
        self.assertEqual(len(set(NAMES)), 14)
        self.assertEqual(len({row[2] for row in apis}), 14)
        service=build_services(self.args(only='agenthub',host='0.0.0.0'))[0]
        self.assertEqual(service.command[service.command.index('--host')+1],'127.0.0.1')
        self.assertEqual(apis[NAMES.index('macro')], ('.', 'macro_api:app', 8015))
        self.assertNotIn(8011, [row[2] for row in apis])

    def test_plan_uses_one_environment_for_all_apis(self):
        services = build_services(self.args())
        self.assertEqual(len(services), 15)
        for service in services[:-1]:
            self.assertIn('--no-project', service.command)
            self.assertIn('--no-python-downloads', service.command)
            self.assertIn(str(Path('python/.venv/Scripts/python.exe' if os.name == 'nt' else 'python/.venv/bin/python').resolve()), service.command)
            self.assertTrue(service.cwd.is_dir())
        self.assertEqual(services[-1].name, 'next')

    def test_unknown_service_and_frontend_only(self):
        with self.assertRaises(ValueError):
            build_services(self.args(only='not-a-server'))
        self.assertEqual([s.name for s in build_services(self.args(only='next', python='does-not-exist'))], ['next'])

    def test_port_probe_does_not_claim_readiness(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); sock.listen()
            self.assertTrue(is_port_in_use(sock.getsockname()[1]))

    def test_owned_process_tree_is_stopped(self):
        with tempfile.TemporaryDirectory() as folder:
            record = Path(folder) / 'pid.json'
            source = 'import subprocess,sys,time,json; from pathlib import Path; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(90)"]); Path(sys.argv[1]).write_text(json.dumps(p.pid)); time.sleep(90)'
            options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
            proc = subprocess.Popen([sys.executable, '-c', source, str(record)], **options)
            try:
                deadline = time.monotonic() + 10
                while not record.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(record.exists())
                child = json.loads(record.read_text())
                stop_process(proc)
                self.assertIsNotNone(proc.poll())
                if os.name == 'nt':
                    import ctypes
                    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                    kernel.OpenProcess.restype = ctypes.c_void_p
                    handle = kernel.OpenProcess(0x00100000, False, child)
                    if handle:
                        kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
                        self.assertEqual(kernel.WaitForSingleObject(handle, 3000), 0)
                        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
                        kernel.CloseHandle(handle)
            finally:
                if proc.poll() is None:
                    stop_process(proc)

if __name__ == '__main__':
    unittest.main()
