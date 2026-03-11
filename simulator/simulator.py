import time
import json
import random
import paho.mqtt.client as mqtt

BROKER = "mosquitto"
PORT = 1883

devices = ["SW-1001","SW-1002","SW-1003","SW-1004"]

client = mqtt.Client()
client.connect(BROKER, PORT)

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