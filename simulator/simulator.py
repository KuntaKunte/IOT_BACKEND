import os
import time
import json
import random
import paho.mqtt.client as mqtt

# Allow overriding via environment (useful when running outside Docker)
BROKER = os.getenv('MQTT_HOST', 'mosquitto')
PORT = int(os.getenv('MQTT_PORT', '1883'))
TELEMETRY_INTERVAL = int(os.getenv('SIMULATOR_INTERVAL', '5'))

# Site and device definitions for multi-site simulation
SITES = [
    {
        "site_id": "site_001",
        "site_name": "North Valley",
        "oem": "growatt",
        "devices": ["SW-1001", "SW-1002"]
    },
    {
        "site_id": "site_002",
        "site_name": "South Ridge",
        "oem": "sungrow",
        "devices": ["SW-1003", "SW-1004"]
    },
    {
        "site_id": "site_003",
        "site_name": "East Lake",
        "oem": "solis",
        "devices": ["SW-1005", "SW-1006"]
    },
        {
        "site_id": "site_005",
        "site_name": "Montana",
        "oem": "DYE",
        "devices": ["SW-1007", "SW-1008"]
    }

]

# Battery voltage thresholds based on backend defaults
BATTERY_MIN_VOLTAGE = 18.0
BATTERY_MAX_VOLTAGE = 28.8
BATTERY_WARNING_THRESHOLD = 40
BATTERY_CRITICAL_THRESHOLD = 20

# Build device registry from sites
devices = []
for site in SITES:
    for device_id in site["devices"]:
        devices.append({
            "device_id": device_id,
            "site_id": site["site_id"],
            "site_name": site["site_name"],
            "oem": site["oem"]
        })


def choose_battery_state():
    # Simulate mostly healthy devices, with a smaller number in warning or critical.
    roll = random.random()
    if roll < 0.75:
        return "green"
    if roll < 0.92:
        return "yellow"
    return "red"


def battery_voltage_for_state(state):
    if state == "green":
        low = BATTERY_MIN_VOLTAGE + (BATTERY_WARNING_THRESHOLD / 100) * (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)
        high = BATTERY_MAX_VOLTAGE
        return round(random.uniform(low + 0.5, high), 2)
    if state == "yellow":
        low = BATTERY_MIN_VOLTAGE + (BATTERY_CRITICAL_THRESHOLD / 100) * (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)
        high = BATTERY_MIN_VOLTAGE + (BATTERY_WARNING_THRESHOLD / 100) * (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)
        return round(random.uniform(low + 0.2, high - 0.2), 2)
    # red
    high = BATTERY_MIN_VOLTAGE + (BATTERY_CRITICAL_THRESHOLD / 100) * (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)
    return round(random.uniform(BATTERY_MIN_VOLTAGE, high - 0.1), 2)


def calculate_battery_percentage(voltage):
    percentage = ((voltage - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)) * 100
    return max(0, min(100, round(percentage, 1)))


def on_message(client, userdata, message):
    topic = message.topic
    payload = json.loads(message.payload.decode())
    device_id = topic.split('/')[1]

    print(f"Received command for {device_id}: {payload}")

    # Simulate command execution with a brief delay
    time.sleep(1)

    response_topic = f"solar/{device_id}/response"
    response_payload = {
        "command_id": payload.get("command_id"),
        "status": "completed",
        "result": f"Command {payload.get('command')} executed successfully"
    }
    client.publish(response_topic, json.dumps(response_payload))
    print(f"Sent response: {response_payload}")


client = mqtt.Client()
client.on_message = on_message
client.connect(BROKER, PORT)
client.subscribe("solar/+/commands")

# Publish initial online status for every device
for device in devices:
    status_topic = f"solar/{device['device_id']}/status"
    status_payload = {
        "device_id": device["device_id"],
        "site_id": device["site_id"],
        "status": "online"
    }
    client.publish(status_topic, json.dumps(status_payload))

client.loop_start()

while True:
    for device in devices:
        battery_state = choose_battery_state()
        battery_voltage = battery_voltage_for_state(battery_state)
        battery_percentage = calculate_battery_percentage(battery_voltage)

        payload = {
            "device_id": device["device_id"],
            "site_id": device["site_id"],
            "site_name": device["site_name"],
            "oem": device["oem"],
            "pv_voltage": round(random.uniform(45, 55), 2),
            "battery_voltage": battery_voltage,
            "battery_percentage": battery_percentage,
            "battery_state": battery_state,
            "current": round(random.uniform(1, 5), 2),
            "temperature": round(random.uniform(28, 42), 2)
        }

        topic = f"solar/{device['device_id']}/telemetry"
        client.publish(topic, json.dumps(payload))
        print(f"Sent telemetry for {device['device_id']} ({device['site_id']}): {payload}")

    time.sleep(TELEMETRY_INTERVAL)
