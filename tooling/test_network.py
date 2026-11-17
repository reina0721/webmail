"""Choose an explicit, non-overlapping IPv4 subnet for disposable test actors."""
import ipaddress
import json
import subprocess


def select_subnet(occupied):
    networks = [ipaddress.ip_network(value, strict=False) for value in occupied]
    for candidate in ipaddress.ip_network('172.16.0.0/12').subnets(new_prefix=24):
        if all(network.version != 4 or not candidate.overlaps(network) for network in networks):
            return str(candidate)
    raise RuntimeError('No unused private test subnet; free a disposable Docker network first')


def available_subnet():
    ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
    networks = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *ids], text=True)) if ids else []
    occupied = [item['Subnet'] for network in networks for item in network.get('IPAM', {}).get('Config') or [] if item.get('Subnet')]
    try:
        routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show'], text=True))
        occupied.extend(route['dst'] for route in routes if route.get('dst') and route['dst'] != 'default')
    except FileNotFoundError:
        pass  # Some minimal development hosts have no iproute2; Docker conflicts remain checked.
    return select_subnet(occupied)
