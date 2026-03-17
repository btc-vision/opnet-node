#!/bin/bash
#===============================================================================
#  HIGH-THROUGHPUT HTTP NETWORK/KERNEL TUNING SCRIPT
#  For servers handling massive concurrent HTTP connections
#===============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_ok() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_err() {
    echo -e "${RED}[-]${NC} $1"
}

if [ "$EUID" -ne 0 ]; then
    echo "Run as root: sudo $0"
    exit 1
fi

print_header "HIGH-THROUGHPUT HTTP TUNING"

echo "This script will tune:"
echo "  - Memory: Hugepages, NUMA, THP, swappiness"
echo "  - Network: Buffers, TCP/UDP, queues"
echo "  - Kernel: Scheduler, AIO, file descriptors"
echo "  - NIC: Ring buffers, offloads"
echo "  - Conntrack: Table sizes for stateful firewalls"
echo ""

#===============================================================================
print_header "1. MEMORY TUNING"
#===============================================================================

sysctl -w vm.swappiness=10 >/dev/null
sysctl -w vm.dirty_ratio=40 >/dev/null
sysctl -w vm.dirty_background_ratio=5 >/dev/null
sysctl -w vm.dirty_expire_centisecs=3000 >/dev/null
sysctl -w vm.dirty_writeback_centisecs=500 >/dev/null
sysctl -w vm.vfs_cache_pressure=50 >/dev/null
print_ok "VM: swappiness=10, dirty_ratio=40"

echo never > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true
echo never > /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || true
print_ok "Transparent Hugepages: disabled"

sysctl -w kernel.numa_balancing=0 >/dev/null 2>&1 || true
print_ok "NUMA balancing: disabled"

sysctl -w vm.overcommit_memory=1 >/dev/null
print_ok "Memory overcommit: enabled"

sysctl -w vm.max_map_count=1048576 >/dev/null
print_ok "Max map count: 1048576"

sysctl -w vm.zone_reclaim_mode=0 >/dev/null 2>&1 || true

#===============================================================================
print_header "2. NETWORK STACK TUNING"
#===============================================================================

sysctl -w net.core.rmem_max=2147483647 >/dev/null
sysctl -w net.core.wmem_max=2147483647 >/dev/null
sysctl -w net.core.rmem_default=16777216 >/dev/null
sysctl -w net.core.wmem_default=16777216 >/dev/null
print_ok "Core buffers: 2GB max, 16MB default"

sysctl -w net.core.optmem_max=67108864 >/dev/null
print_ok "Socket option memory: 64MB"

sysctl -w net.core.netdev_max_backlog=1000000 >/dev/null
sysctl -w net.core.somaxconn=65535 >/dev/null
print_ok "Backlog: 1M packets, somaxconn: 65535"

# busy_poll MUST be 0, spin-waiting burns CPU under flood load
sysctl -w net.core.busy_poll=0 >/dev/null
sysctl -w net.core.busy_read=0 >/dev/null
print_ok "Busy polling: DISABLED (causes CPU starvation under flood)"

sysctl -w net.core.flow_limit_table_len=8192 >/dev/null

#===============================================================================
print_header "3. TCP/IP TUNING"
#===============================================================================

sysctl -w net.ipv4.tcp_mem="8388608 12582912 16777216" >/dev/null
sysctl -w net.ipv4.tcp_rmem="4096 1048576 2147483647" >/dev/null
sysctl -w net.ipv4.tcp_wmem="4096 1048576 2147483647" >/dev/null
print_ok "TCP memory: 64GB max"

sysctl -w net.ipv4.udp_mem="8388608 12582912 16777216" >/dev/null
sysctl -w net.ipv4.udp_rmem_min=16384 >/dev/null
sysctl -w net.ipv4.udp_wmem_min=16384 >/dev/null
print_ok "UDP memory: 64GB max"

sysctl -w net.ipv4.tcp_max_syn_backlog=1048576 >/dev/null
sysctl -w net.ipv4.tcp_max_tw_buckets=2000000 >/dev/null
sysctl -w net.ipv4.tcp_tw_reuse=1 >/dev/null
sysctl -w net.ipv4.tcp_fin_timeout=5 >/dev/null
print_ok "TCP backlog: 1M, TIME_WAIT: 2M, FIN timeout: 5s"

sysctl -w net.ipv4.tcp_slow_start_after_idle=0 >/dev/null
print_ok "TCP slow start after idle: disabled"

sysctl -w net.ipv4.tcp_keepalive_time=30 >/dev/null
sysctl -w net.ipv4.tcp_keepalive_intvl=5 >/dev/null
sysctl -w net.ipv4.tcp_keepalive_probes=3 >/dev/null
print_ok "TCP keepalive: 30s/5s/3 probes"

sysctl -w net.ipv4.tcp_fastopen=3 >/dev/null
print_ok "TCP Fast Open: enabled (client+server)"

sysctl -w net.ipv4.ip_local_port_range="1024 65535" >/dev/null
print_ok "Local port range: 1024-65535 (64K ports)"

sysctl -w net.ipv4.tcp_no_metrics_save=1 >/dev/null
print_ok "TCP metrics cache: disabled"

sysctl -w net.ipv4.tcp_window_scaling=1 >/dev/null
sysctl -w net.ipv4.tcp_adv_win_scale=1 >/dev/null

# timestamps MUST be on for tcp_tw_reuse and PAWS protection
sysctl -w net.ipv4.tcp_sack=1 >/dev/null
sysctl -w net.ipv4.tcp_dsack=1 >/dev/null
sysctl -w net.ipv4.tcp_timestamps=1 >/dev/null
print_ok "TCP: SACK=on, timestamps=on (needed for tw_reuse)"

# Compressed SACK - reduce ACK overhead under high load
sysctl -w net.ipv4.tcp_comp_sack_delay_ns=0 >/dev/null 2>&1 || true
sysctl -w net.ipv4.tcp_comp_sack_nr=0 >/dev/null 2>&1 || true
print_ok "TCP compressed SACK: minimal delay"

# Autocorking - let kernel batch small writes
sysctl -w net.ipv4.tcp_autocorking=1 >/dev/null
print_ok "TCP autocorking: enabled"

# Reduce memory on idle keepalive connections (nginx/envoy can override per-socket)
sysctl -w net.ipv4.tcp_notsent_lowat=16384 >/dev/null
print_ok "TCP notsent_lowat: 16KB (saves memory on idle conns)"

# Don't RST when listen queue overflows, just drop the SYN silently
sysctl -w net.ipv4.tcp_abort_on_overflow=0 >/dev/null
print_ok "TCP abort on overflow: disabled"

sysctl -w net.ipv4.tcp_mtu_probing=1 >/dev/null

# Congestion control
modprobe tcp_bbr 2>/dev/null || true
if grep -q bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
    sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null
    sysctl -w net.core.default_qdisc=fq >/dev/null
    print_ok "Congestion control: BBR + fq"
else
    sysctl -w net.ipv4.tcp_congestion_control=cubic >/dev/null
    print_warn "BBR not available, using CUBIC"
fi

sysctl -w net.ipv4.tcp_max_orphans=262144 >/dev/null
sysctl -w net.ipv4.tcp_orphan_retries=1 >/dev/null

sysctl -w net.ipv4.tcp_syncookies=1 >/dev/null
sysctl -w net.ipv4.tcp_synack_retries=2 >/dev/null
sysctl -w net.ipv4.tcp_syn_retries=2 >/dev/null

sysctl -w net.ipv4.tcp_retries1=3 >/dev/null
sysctl -w net.ipv4.tcp_retries2=5 >/dev/null

# Security hardening
sysctl -w net.ipv4.conf.all.accept_redirects=0 >/dev/null
sysctl -w net.ipv4.conf.all.send_redirects=0 >/dev/null
sysctl -w net.ipv4.conf.all.accept_source_route=0 >/dev/null
sysctl -w net.ipv6.conf.all.accept_redirects=0 >/dev/null

sysctl -w net.ipv4.ipfrag_high_thresh=8388608 >/dev/null
sysctl -w net.ipv4.ipfrag_low_thresh=6291456 >/dev/null

sysctl -w net.ipv4.neigh.default.gc_thresh1=8192 >/dev/null
sysctl -w net.ipv4.neigh.default.gc_thresh2=32768 >/dev/null
sysctl -w net.ipv4.neigh.default.gc_thresh3=65536 >/dev/null
print_ok "ARP cache: 64K entries"

# Strict reverse path filter (security for HTTP-facing servers)
sysctl -w net.ipv4.conf.all.rp_filter=1 >/dev/null
sysctl -w net.ipv4.conf.default.rp_filter=1 >/dev/null
print_ok "Reverse path filter: strict mode"

sysctl -w net.ipv4.neigh.default.base_reachable_time_ms=30000 >/dev/null
sysctl -w net.ipv4.neigh.default.gc_stale_time=120 >/dev/null

#===============================================================================
print_header "4. CONNTRACK TUNING"
#===============================================================================

# If nf_conntrack is loaded (iptables/nftables), crank table size up.
# Without this you will hit "nf_conntrack: table full, dropping packet" under load.
if lsmod | grep -q nf_conntrack 2>/dev/null; then
    sysctl -w net.netfilter.nf_conntrack_max=2097152 >/dev/null 2>&1 || true
    sysctl -w net.netfilter.nf_conntrack_buckets=524288 >/dev/null 2>&1 || \
        echo 524288 > /sys/module/nf_conntrack/parameters/hashsize 2>/dev/null || true
    sysctl -w net.netfilter.nf_conntrack_tcp_timeout_established=600 >/dev/null 2>&1 || true
    sysctl -w net.netfilter.nf_conntrack_tcp_timeout_time_wait=5 >/dev/null 2>&1 || true
    sysctl -w net.netfilter.nf_conntrack_tcp_timeout_fin_wait=5 >/dev/null 2>&1 || true
    sysctl -w net.netfilter.nf_conntrack_tcp_timeout_close_wait=5 >/dev/null 2>&1 || true
    sysctl -w net.netfilter.nf_conntrack_generic_timeout=60 >/dev/null 2>&1 || true
    print_ok "Conntrack: 2M entries, aggressive timeouts"
else
    print_warn "nf_conntrack not loaded, skipping conntrack tuning"
fi

#===============================================================================
print_header "5. KERNEL TUNING"
#===============================================================================

sysctl -w fs.aio-max-nr=2097152 >/dev/null
print_ok "AIO max: 2M operations"

sysctl -w fs.file-max=10000000 >/dev/null
sysctl -w fs.nr_open=10000000 >/dev/null
print_ok "File descriptors: 10M max"

sysctl -w fs.inotify.max_user_watches=524288 >/dev/null
sysctl -w fs.inotify.max_user_instances=8192 >/dev/null

sysctl -w fs.epoll.max_user_watches=10485760 >/dev/null 2>&1 || true

sysctl -w kernel.pid_max=4194304 >/dev/null
print_ok "PID max: 4M"

sysctl -w kernel.threads-max=4194304 >/dev/null
print_ok "Threads max: 4M"

sysctl -w kernel.shmmax=68719476736 >/dev/null
sysctl -w kernel.shmall=4294967296 >/dev/null
print_ok "Shared memory: 64GB max"

sysctl -w kernel.msgmnb=65536 >/dev/null
sysctl -w kernel.msgmax=65536 >/dev/null

sysctl -w kernel.sched_min_granularity_ns=10000000 >/dev/null 2>&1 || true
sysctl -w kernel.sched_wakeup_granularity_ns=15000000 >/dev/null 2>&1 || true
sysctl -w kernel.sched_migration_cost_ns=5000000 >/dev/null 2>&1 || true
sysctl -w kernel.sched_autogroup_enabled=0 >/dev/null 2>&1 || true
print_ok "Scheduler: tuned for throughput"

sysctl -w kernel.timer_migration=0 >/dev/null 2>&1 || true

echo -1 > /proc/sys/kernel/sched_rt_runtime_us 2>/dev/null || true

sysctl -w kernel.perf_event_paranoid=-1 >/dev/null 2>&1 || true

#===============================================================================
print_header "6. ULIMITS"
#===============================================================================

ulimit -n 10000000 2>/dev/null || ulimit -n 1048576 2>/dev/null || true
ulimit -u 4194304 2>/dev/null || true
ulimit -l unlimited 2>/dev/null || true
ulimit -s unlimited 2>/dev/null || true

cat > /etc/security/limits.d/99-network-perf.conf << 'EOF'
# High-Throughput HTTP Limits
* soft nofile 10000000
* hard nofile 10000000
* soft nproc 4194304
* hard nproc 4194304
* soft memlock unlimited
* hard memlock unlimited
* soft stack unlimited
* hard stack unlimited
* soft core unlimited
* hard core unlimited
root soft nofile 10000000
root hard nofile 10000000
root soft nproc 4194304
root hard nproc 4194304
root soft memlock unlimited
root hard memlock unlimited
EOF
print_ok "Ulimits: 10M files, unlimited memory"

#===============================================================================
print_header "7. NIC TUNING"
#===============================================================================

tune_nic() {
    local iface=$1

    [[ "$iface" == "lo" ]] && return
    [[ "$iface" == veth* ]] && return
    [[ "$iface" == docker* ]] && return
    [[ "$iface" == br-* ]] && return
    [[ "$iface" == virbr* ]] && return

    [ -d "/sys/class/net/$iface" ] || return

    # Skip interfaces that are down
    local state=$(cat /sys/class/net/$iface/operstate 2>/dev/null)
    [[ "$state" != "up" ]] && return

    echo -e "  ${YELLOW}Tuning: $iface${NC}"

    local max_rx=$(ethtool -g $iface 2>/dev/null | grep -A4 "Pre-set" | grep "RX:" | awk '{print $2}' | head -1)
    local max_tx=$(ethtool -g $iface 2>/dev/null | grep -A4 "Pre-set" | grep "TX:" | awk '{print $2}' | head -1)
    if [ -n "$max_rx" ] && [ "$max_rx" -gt 0 ] 2>/dev/null; then
        ethtool -G $iface rx $max_rx tx ${max_tx:-$max_rx} 2>/dev/null && \
            echo "    Ring buffers: RX=$max_rx TX=${max_tx:-$max_rx}" || true
    fi

    # Enable standard offloads but NOT LRO (conflicts with XDP if needed later)
    ethtool -K $iface tso on gso on gro on 2>/dev/null || true
    ethtool -K $iface tx on rx on sg on 2>/dev/null || true
    ethtool -K $iface tx-checksum-ip-generic on 2>/dev/null || true
    ethtool -K $iface tx-tcp-segmentation on 2>/dev/null || true
    ethtool -K $iface tx-tcp6-segmentation on 2>/dev/null || true
    ethtool -K $iface ntuple on 2>/dev/null || true
    ethtool -K $iface rxhash on 2>/dev/null || true
    echo "    Offloads: TSO/GSO/GRO enabled (LRO skipped for XDP compat)"

    # Adaptive coalescing - let the NIC decide based on traffic patterns
    ethtool -C $iface adaptive-rx on adaptive-tx on 2>/dev/null || true
    echo "    IRQ coalescing: adaptive"

    # Do NOT change queue count
    local cur_queues=$(ethtool -l $iface 2>/dev/null | grep -A4 "Current" | grep "Combined:" | awk '{print $2}')
    echo "    Queues: $cur_queues (not modified)"

    ip link set $iface txqueuelen 10000 2>/dev/null || true
    echo "    TX queue: 10000"

    local mtu=$(cat /sys/class/net/$iface/mtu 2>/dev/null)
    echo "    MTU: $mtu (unchanged)"
}

for iface in $(ls /sys/class/net/); do
    tune_nic "$iface"
done

print_ok "NIC tuning: complete"

#===============================================================================
print_header "8. IRQ AFFINITY"
#===============================================================================

# Detect if any NIC has hardware RSS
HAS_HW_RSS=false
for iface in $(ls /sys/class/net/); do
    [[ "$iface" == "lo" ]] && continue
    local_driver=$(ethtool -i $iface 2>/dev/null | grep "driver:" | awk '{print $2}')
    case "$local_driver" in
        mlx5_core|mlx4_en|i40e|ixgbe|ice|ena|bnxt_en)
            HAS_HW_RSS=true
            print_ok "$iface ($local_driver): Hardware RSS detected, skipping RPS/manual IRQ affinity"
            # Explicitly disable RPS in case it was enabled before
            for rxq in /sys/class/net/$iface/queues/rx-*/rps_cpus; do
                echo 0 > $rxq 2>/dev/null || true
            done
            ;;
        *)
            # For NICs without hardware RSS, enable RPS
            local num_cpus=$(nproc)
            local rps_mask=$(printf "%x" $((2**num_cpus - 1)))
            for rxq in /sys/class/net/$iface/queues/rx-*/rps_cpus; do
                echo $rps_mask > $rxq 2>/dev/null || true
            done
            for flow in /sys/class/net/$iface/queues/rx-*/rps_flow_cnt; do
                echo 32768 > $flow 2>/dev/null || true
            done
            sysctl -w net.core.rps_sock_flow_entries=32768 >/dev/null 2>&1 || true
            print_ok "$iface: Software RPS enabled (no hardware RSS)"
            ;;
    esac
done

print_ok "IRQ affinity: letting kernel and hardware handle placement"

#===============================================================================
print_header "9. DISK I/O TUNING"
#===============================================================================

for dev in /sys/block/sd* /sys/block/nvme* /sys/block/vd*; do
    [ -d "$dev" ] || continue
    devname=$(basename $dev)

    if [[ "$devname" == nvme* ]]; then
        echo none > $dev/queue/scheduler 2>/dev/null || true
    else
        echo mq-deadline > $dev/queue/scheduler 2>/dev/null || \
        echo deadline > $dev/queue/scheduler 2>/dev/null || true
    fi

    echo 2048 > $dev/queue/nr_requests 2>/dev/null || true

    if [[ "$devname" == nvme* ]]; then
        echo 256 > $dev/queue/read_ahead_kb 2>/dev/null || true
    else
        echo 1024 > $dev/queue/read_ahead_kb 2>/dev/null || true
    fi

    echo 0 > $dev/queue/iostats 2>/dev/null || true
    echo 0 > $dev/queue/add_random 2>/dev/null || true
done
print_ok "Block I/O: tuned"

#===============================================================================
print_header "10. DISABLE JITTER SOURCES"
#===============================================================================

# Stop unneeded services
systemctl stop packagekit 2>/dev/null || true
systemctl stop snapd 2>/dev/null || true
systemctl stop fwupd 2>/dev/null || true
systemctl stop ModemManager 2>/dev/null || true
print_ok "Background services: stopped"

#===============================================================================
print_header "SUMMARY"
#===============================================================================

echo ""
echo -e "${GREEN}+---------------------------------------------------------------+${NC}"
echo -e "${GREEN}|         HIGH-THROUGHPUT HTTP MODE ACTIVATED                    |${NC}"
echo -e "${GREEN}+---------------------------------------------------------------+${NC}"
echo ""
echo "Settings applied:"
echo "  Memory:    THP OFF, no hugepages"
echo "  Network:   2GB buffers, BBR, 64K ports, 1M backlog"
echo "  TCP:       timestamps ON, tw_reuse, TFO, notsent_lowat"
echo "  Conntrack: 2M entries (if nf_conntrack loaded)"
echo "  Kernel:    10M file descriptors, 2M AIO, 4M PIDs"
echo "  NICs:      Max ring buffers, offloads, adaptive coalescing"
echo "  IRQs:      Kernel default (hardware RSS handles distribution)"
echo "  Security:  rp_filter=strict, syncookies, no redirects"
echo ""
echo -e "${YELLOW}WHAT WAS REMOVED (these caused server crashes under load):${NC}"
echo "  - busy_poll/busy_read (spin-wait burns CPU under flood)"
echo "  - RPS on hardware RSS NICs (double-processes every packet)"
echo "  - Manual IRQ affinity (scattered across NUMA nodes)"
echo "  - irqbalance disable (needed for NUMA-aware placement)"
echo "  - netdev_budget override (kernel default is correct)"
echo ""

# Persistent config
cat > /etc/sysctl.d/99-http-throughput.conf << 'EOF'
# High-Throughput HTTP Tuning - Generated by tweak.sh (FIXED)

# Memory
vm.swappiness=10
vm.dirty_ratio=40
vm.dirty_background_ratio=5
vm.dirty_expire_centisecs=3000
vm.dirty_writeback_centisecs=500
vm.vfs_cache_pressure=50
vm.overcommit_memory=1
vm.max_map_count=1048576
vm.zone_reclaim_mode=0
kernel.numa_balancing=0

# Core network
net.core.rmem_max=2147483647
net.core.wmem_max=2147483647
net.core.rmem_default=16777216
net.core.wmem_default=16777216
net.core.optmem_max=67108864
net.core.netdev_max_backlog=1000000
net.core.somaxconn=65535
# FIXED: no netdev_budget override - kernel default is correct
# FIXED: busy_poll=0 - spin-waiting kills performance under flood
net.core.busy_poll=0
net.core.busy_read=0
net.core.flow_limit_table_len=8192
net.core.default_qdisc=fq

# TCP
net.ipv4.tcp_mem=8388608 12582912 16777216
net.ipv4.tcp_rmem=4096 1048576 2147483647
net.ipv4.tcp_wmem=4096 1048576 2147483647
net.ipv4.tcp_max_syn_backlog=1048576
net.ipv4.tcp_max_tw_buckets=2000000
net.ipv4.tcp_tw_reuse=1
net.ipv4.tcp_fin_timeout=5
net.ipv4.tcp_slow_start_after_idle=0
net.ipv4.tcp_keepalive_time=30
net.ipv4.tcp_keepalive_intvl=5
net.ipv4.tcp_keepalive_probes=3
net.ipv4.tcp_fastopen=3
net.ipv4.tcp_no_metrics_save=1
net.ipv4.tcp_sack=1
net.ipv4.tcp_dsack=1
net.ipv4.tcp_timestamps=1
net.ipv4.tcp_window_scaling=1
net.ipv4.tcp_adv_win_scale=1
net.ipv4.tcp_mtu_probing=1
net.ipv4.tcp_congestion_control=bbr
net.ipv4.tcp_max_orphans=262144
net.ipv4.tcp_orphan_retries=1
net.ipv4.tcp_syncookies=1
net.ipv4.tcp_synack_retries=2
net.ipv4.tcp_syn_retries=2
net.ipv4.tcp_retries1=3
net.ipv4.tcp_retries2=5
net.ipv4.tcp_autocorking=1
net.ipv4.tcp_notsent_lowat=16384
net.ipv4.tcp_abort_on_overflow=0
net.ipv4.ip_local_port_range=1024 65535

# UDP
net.ipv4.udp_mem=8388608 12582912 16777216
net.ipv4.udp_rmem_min=16384
net.ipv4.udp_wmem_min=16384

# IP fragmentation
net.ipv4.ipfrag_high_thresh=8388608
net.ipv4.ipfrag_low_thresh=6291456

# ARP
net.ipv4.neigh.default.gc_thresh1=8192
net.ipv4.neigh.default.gc_thresh2=32768
net.ipv4.neigh.default.gc_thresh3=65536
net.ipv4.neigh.default.base_reachable_time_ms=30000
net.ipv4.neigh.default.gc_stale_time=120

# Security
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.default.rp_filter=1
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.all.accept_source_route=0
net.ipv6.conf.all.accept_redirects=0

# Filesystem and kernel
fs.aio-max-nr=2097152
fs.file-max=10000000
fs.nr_open=10000000
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=8192
kernel.pid_max=4194304
kernel.threads-max=4194304
kernel.shmmax=68719476736
kernel.shmall=4294967296
kernel.msgmnb=65536
kernel.msgmax=65536
kernel.sched_autogroup_enabled=0
kernel.timer_migration=0
kernel.perf_event_paranoid=-1
EOF

print_ok "Persistent config: /etc/sysctl.d/99-http-throughput.conf"

echo ""
echo -e "${YELLOW}NOTE: Reboot recommended for full effect${NC}"
echo -e "${YELLOW}NOTE: Re-run this script after reboot for runtime settings${NC}"
echo ""
