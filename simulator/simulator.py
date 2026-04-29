import time
import json
import random
import paho.mqtt.client as mqtt

BROKER = "mosquitto"
PORT = 1883

devices = ["SW-1001","SW-1002","SW-1003","SW-1004"]

def on_message(client, userdata, message):
    topic = message.topic
    payload = json.loads(message.payload.decode())
    device_id = topic.split('/')[1]
    
    print(f"Received command for {device_id}: {payload}")
    
    # Simulate command execution
    time.sleep(1)
    
    # Send response
    response_topic = f"solar/{device_id}/response"
    response_payload = {
        "command_id": payload.get("command_id"),
        "status": "completed",
        "result": f"Command {payload['command']} executed successfully"
    }
    client.publish(response_topic, json.dumps(response_payload))
    print(f"Sent response: {response_payload}")

client = mqtt.Client()
client.on_message = on_message
client.connect(BROKER, PORT)

# Subscribe to command topics for all devices
for device in devices:
    client.subscribe(f"solar/{device}/commands")

# Send initial status
for device in devices:
    status_topic = f"solar/{device}/status"
    status_payload = {"status": "online"}
    client.publish(status_topic, json.dumps(status_payload))

client.loop_start()

while True:
    for device in devices:
        payload = {
            "device_id": device,
            "pv_voltage": round(random.uniform(45, 55),2),
            "battery_voltage": round(random.uniform(24, 28),2),
            "current": round(random.uniform(1, 5),2),
            "temperature": round(random.uniform(30, 40),2)
        }

        topic = f"solar/{device}/telemetry"

        client.publish(topic, json.dumps(payload))

        print("Sent:", payload)

    time.sleep(5)