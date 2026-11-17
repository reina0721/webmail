"""Explicit test subnets must not collide with Docker or host routes."""
import importlib.util
import pathlib
import unittest
spec=importlib.util.spec_from_file_location('test_network', pathlib.Path(__file__).resolve().parents[1]/'tooling/test_network.py')
network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)

class TestSubnet(unittest.TestCase):
    def test_returns_a_private_explicit_subnet(self):
        self.assertEqual(network.select_subnet([]), '172.16.0.0/24')
    def test_skips_docker_networks_and_host_routes(self):
        self.assertEqual(network.select_subnet(['172.16.0.0/16','172.17.0.0/24']), '172.17.1.0/24')
    def test_skips_overlaps_in_both_directions(self):
        self.assertEqual(network.select_subnet(['172.16.0.128/25']), '172.16.1.0/24')
    def test_ipv6_does_not_block_ipv4(self):
        self.assertEqual(network.select_subnet(['fd00::/8']), '172.16.0.0/24')
    def test_exhaustion_fails_explicitly(self):
        with self.assertRaisesRegex(RuntimeError,'No unused private test subnet'):
            network.select_subnet(['172.16.0.0/12'])

if __name__=='__main__': unittest.main()
