#!/bin/bash

# Script to delete the RAID array created

# Variables
raid_device="/dev/md0"
raid_mount_point="/mnt/raid"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root or with sudo."
    exit 1
fi

# Unmount the RAID mount point
if mountpoint -q "$raid_mount_point"; then
    echo "Unmounting $raid_mount_point..."
    umount "$raid_mount_point"
else
    echo "$raid_mount_point is not mounted."
fi

# Stop the RAID array
if [ -e "$raid_device" ]; then
    echo "Stopping RAID array $raid_device..."
    mdadm --stop "$raid_device"
else
    echo "RAID device $raid_device does not exist."
fi

# Remove the RAID array
if [ -e "$raid_device" ]; then
    echo "Removing RAID device $raid_device..."
    mdadm --remove "$raid_device"
else
    echo "RAID device $raid_device already removed."
fi

# Remove RAID configuration from mdadm.conf
if [ -f /etc/mdadm/mdadm.conf ]; then
    echo "Updating /etc/mdadm/mdadm.conf..."
    sed -i "\|$raid_device|d" /etc/mdadm/mdadm.conf
    update-initramfs -u
fi

# Remove entry from /etc/fstab
echo "Removing RAID mount point from /etc/fstab..."
sed -i "\|$raid_mount_point|d" /etc/fstab

# Zero the superblock on each disk
echo "Zeroing superblocks on RAID member disks..."
for disk in $(mdadm --detail "$raid_device" | grep '/dev/' | awk '{print $7}'); do
    echo "Zeroing superblock on $disk..."
    mdadm --zero-superblock "$disk"
done

# Remove RAID mount point directory
if [ -d "$raid_mount_point" ]; then
    echo "Removing RAID mount point directory $raid_mount_point..."
    rmdir "$raid_mount_point"
fi

echo "RAID array $raid_device has been deleted."
