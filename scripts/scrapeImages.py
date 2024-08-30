import requests
import os
from concurrent.futures import ThreadPoolExecutor

def fetch_muesliswap_tokens():
    url = "https://api.muesliswap.com/list?base-policy-id=&base-asset-name="
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Failed to fetch token list. Status code: {response.status_code}")
        return None

def download_image(token):
    policy_id = token['info']['address']['policyId']
    token_name = token['info']['address']['name']
    image_url = token['info'].get('image')

    if not image_url:
        print(f"No image URL for {policy_id}{token_name}")
        return

    filename = f"{policy_id}{token_name}.png"
    filepath = os.path.join("public", "assets", filename)

    response = requests.get(image_url)
    if response.status_code == 200:
        with open(filepath, "wb") as f:
            f.write(response.content)
        print(f"Downloaded: {filename}")
    else:
        print(f"Failed to download: {filename}")

def main():
    tokens = fetch_muesliswap_tokens()
    
    if not tokens:
        print("No tokens fetched. Exiting.")
        return

    os.makedirs(os.path.join("public", "assets"), exist_ok=True)

    with ThreadPoolExecutor(max_workers=10) as executor:
        executor.map(download_image, tokens)

if __name__ == "__main__":
    main()
