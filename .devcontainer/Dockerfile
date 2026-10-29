# Base image: pinned by tag now. Pin by digest (FROM image@sha256:...) once the image has been pulled and reviewed on a machine with Docker running.
FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

# The firewall needs iptables and ipset. Nothing else is installed: the harness has no dependencies.
RUN apt-get update \
 && apt-get install -y --no-install-recommends iptables ipset dnsutils ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 # The base image gives the node user passwordless sudo. Remove it: without it the user cannot change the firewall or become root.
 && rm -f /etc/sudoers.d/* \
 && (apt-get purge -y sudo 2>/dev/null || true) \
 # Deny git push from inside the container, whatever credentials appear. Defence in depth: the credential helper and SSH agent are
 # disabled in devcontainer.json and by user settings, and the firewall does not allow the Git hosts.
 && mkdir -p /opt/harness-hooks

COPY allowed-hosts.txt /opt/harness/allowed-hosts.txt
COPY init-firewall.sh /opt/harness/init-firewall.sh
COPY pre-push-deny /opt/harness-hooks/pre-push
RUN sed -i 's/\r$//' /opt/harness/init-firewall.sh /opt/harness/allowed-hosts.txt /opt/harness-hooks/pre-push \
 && chmod 0555 /opt/harness/init-firewall.sh /opt/harness-hooks/pre-push \
 && chmod 0444 /opt/harness/allowed-hosts.txt \
 && git config --system core.hooksPath /opt/harness-hooks \
 && git config --system --add safe.directory /workspaces/greenfuel-agent-harness

# Runs as root (containerUser) so it can set the firewall, then idles. The attached user (node) has no capabilities and no sudo.
ENTRYPOINT ["/bin/bash", "-c", "/opt/harness/init-firewall.sh && exec sleep infinity"]
