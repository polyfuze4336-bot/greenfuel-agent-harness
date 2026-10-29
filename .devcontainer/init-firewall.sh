#!/bin/bash
# Default-deny outbound firewall for the isolated execution environment. Runs once, as root, from the image entrypoint.
# Only the hosts in /opt/harness/allowed-hosts.txt are reachable. The host machine, the Docker host network and everything else are not.
# Fail closed: if the rules cannot be applied the script exits non-zero, the entrypoint stops, and the container does not start.
# Status: written and statically validated; NOT executed on this machine (Docker is not running here).
set -euo pipefail

ALLOW=/opt/harness/allowed-hosts.txt
[ -r "$ALLOW" ] || { echo "firewall: $ALLOW is missing" >&2; exit 1; }

# Keep the container's own DNS servers reachable before locking down.
mapfile -t DNS < <(awk '/^nameserver/ {print $2}' /etc/resolv.conf | grep -E '^[0-9.]+$' || true)
[ "${#DNS[@]}" -gt 0 ] || { echo "firewall: no IPv4 nameserver found" >&2; exit 1; }

ipset destroy harness-allow 2>/dev/null || true
ipset create harness-allow hash:net family inet

added=0
while read -r host _; do
  case "$host" in ''|\#*) continue ;; esac
  mapfile -t ips < <(getent ahostsv4 "$host" | awk '{print $1}' | sort -u)
  if [ "${#ips[@]}" -eq 0 ]; then echo "firewall: cannot resolve $host (skipped)" >&2; continue; fi
  for ip in "${ips[@]}"; do ipset add -exist harness-allow "$ip" && added=$((added + 1)); done
done < "$ALLOW"
[ "$added" -gt 0 ] || { echo "firewall: no allowed address could be resolved; refusing to start with an empty allowlist" >&2; exit 1; }

iptables -F; iptables -X
iptables -P INPUT DROP; iptables -P FORWARD DROP; iptables -P OUTPUT DROP
iptables -A INPUT -i lo -j ACCEPT; iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for d in "${DNS[@]}"; do
  iptables -A OUTPUT -p udp -d "$d" --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp -d "$d" --dport 53 -j ACCEPT
done
iptables -A OUTPUT -p tcp --dport 443 -m set --match-set harness-allow dst -j ACCEPT
# Record what was blocked so the owner can see it (read with: dmesg | grep harness-egress-denied, as root on the host).
iptables -A OUTPUT -m limit --limit 5/min -j LOG --log-prefix "harness-egress-denied: "

# IPv6 is closed entirely.
ip6tables -P INPUT DROP 2>/dev/null || true; ip6tables -P FORWARD DROP 2>/dev/null || true; ip6tables -P OUTPUT DROP 2>/dev/null || true

# Self-check: a host that is not on the list must be unreachable.
if curl -sS --max-time 5 -o /dev/null https://example.com 2>/dev/null; then echo "firewall: self-check failed, example.com is reachable" >&2; exit 1; fi
echo "firewall: default-deny active; $added allowed address(es) from $(grep -cvE '^\s*(#|$)' "$ALLOW") host(s)"
