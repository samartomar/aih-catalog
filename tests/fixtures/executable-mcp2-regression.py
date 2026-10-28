"""Offline regression for the delivered MCP2 adaptation; requires the exact isolated closure."""
import asyncio
import importlib.metadata
import importlib.util
import inspect
import json
import pathlib
import runpy
import shutil
import sys
import tempfile
import types
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

if sys.version_info[:3] != (3, 14, 10) or sys.prefix == sys.base_prefix:
    raise RuntimeError('exact-isolated-python-3.14.10-required')
for name, version in [('mcp', '2.3.0'), ('mcp-types', '2.3.0'), ('httpx2', '2.16.0')]:
    if importlib.metadata.version(name) != version:
        raise RuntimeError('dependency-version-mismatch: ' + name)

from mcp.client.streamable_http import streamable_http_client as real_transport
from mcp_types import Tool

root = pathlib.Path(sys.argv.pop(1)).resolve()
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('catalog_adapter_under_test',
    root / 'adaptations/mcp-builder-mcp2/catalog_mcp2_connections.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class MCP2Regression(unittest.IsolatedAsyncioTestCase):
    def test_real_evaluator_import_and_xml_parser(self):
        # Import the complete delivered evaluator and its real connection dependency.
        verify = runpy.run_path(str(root / 'fixture.py'), run_name='regression')['verified_adaptation']
        entry = verify(json.loads((root / 'requirements.json').read_text()), 'mcp-evaluator')
        sys.path.insert(0, str(entry.parent))
        try:
            evaluator = runpy.run_path(str(entry), run_name='catalog_regression')
            connection = sys.modules[evaluator['create_connection'].__module__]
            self.assertEqual(pathlib.Path(connection.__file__).resolve(), entry.with_name('catalog_mcp2_connections.py'))
            with tempfile.TemporaryDirectory(prefix='catalog-mcp2-parser-') as directory:
                questions = pathlib.Path(directory) / 'questions.xml'
                questions.write_text('<evaluation><qa_pair><question>Fixture?</question><answer>Local</answer></qa_pair></evaluation>')
                self.assertEqual(evaluator['parse_evaluation_file'](questions),
                    [{'question': 'Fixture?', 'answer': 'Local'}])
        finally:
            sys.path.pop(0)

    def test_authored_adapter_tampering_and_symlink_refuse(self):
        # Exercise the real verifier on a disposable byte copy, never mutate installation.
        with tempfile.TemporaryDirectory(prefix='catalog-mcp2-regression-') as directory:
            copied = pathlib.Path(directory)
            shutil.copyfile(root / 'fixture.py', copied / 'fixture.py')
            shutil.copytree(root / 'adaptations', copied / 'adaptations')
            requirements = json.loads((root / 'requirements.json').read_text())
            verify = runpy.run_path(str(copied / 'fixture.py'), run_name='regression')['verified_adaptation']
            entry = verify(requirements, 'mcp-evaluator')
            original = entry.read_bytes()
            entry.write_bytes(bytes([original[0] ^ 1]) + original[1:])
            with self.assertRaisesRegex(ValueError, 'adaptation-hash-mismatch'):
                verify(requirements, 'mcp-evaluator')
            entry.unlink()
            entry.symlink_to(root / 'adaptations/mcp-builder-mcp2/catalog_mcp2_evaluation.py')
            with self.assertRaisesRegex(ValueError, 'symlink-adaptation-refused'):
                verify(requirements, 'mcp-evaluator')

    async def test_http_headers_timeout_and_owned_close(self):
        for failure in [None, ValueError, asyncio.CancelledError]:
            with self.subTest(failure=failure):
                observed = []

                @asynccontextmanager
                async def transport(url, *, http_client):
                    # Bind against actual pinned SDK signature, never add an SDK alias.
                    inspect.signature(real_transport).bind(url, http_client=http_client)
                    self.assertEqual(url, 'http://127.0.0.1:1/mcp')
                    self.assertEqual(http_client.headers['x-fixture'], 'offline')
                    self.assertEqual(http_client.timeout.read, 300)
                    self.assertEqual(http_client.timeout.connect, 30)
                    self.assertFalse(http_client.is_closed)
                    observed.append(http_client)
                    try:
                        yield ('read', 'write')
                    finally:
                        self.assertFalse(http_client.is_closed)

                connection = adapter.MCPConnectionHTTP('http://127.0.0.1:1/mcp', {'x-fixture': 'offline'})
                # A scoped adapter dependency double never changes installed SDK exports.
                with patch.object(adapter, 'streamable_http_client', transport):
                    if failure is None:
                        async with connection._create_context() as streams:
                            self.assertEqual(streams, ('read', 'write'))
                    else:
                        with self.assertRaises(failure):
                            async with connection._create_context():
                                raise failure()
                self.assertEqual(len(observed), 1)
                self.assertTrue(observed[0].is_closed)

    async def test_real_sdk_tool_maps_snake_case_schema(self):
        schema = {'type': 'object', 'properties': {}}
        tool = Tool(name='fixture', description='Offline', input_schema=schema)

        class Session:
            async def list_tools(self):
                return types.SimpleNamespace(tools=[tool])

        connection = adapter.MCPConnectionStdio('never-launched')
        connection.session = Session()
        self.assertEqual(await connection.list_tools(), [
            {'name': 'fixture', 'description': 'Offline', 'input_schema': schema}])


if __name__ == '__main__':
    unittest.main()
