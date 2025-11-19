#!/bin/bash

# Get the IP address and hostname
IP_ADDRESS=$(hostname -i | awk '{print $1}')
HOSTNAME=$(hostname)

# Output the information
echo "Hostname: $HOSTNAME"
echo "IP Address: $IP_ADDRESS"
