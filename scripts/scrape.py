import requests
import json
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
    filepath = os.path.join("..", "public", "assets", filename)

    if image_url.startswith('ipfs://'):
        # Handle IPFS URLs using a public gateway
        ipfs_hash = image_url.replace('ipfs://', '')
        image_url = f"https://ipfs.io/ipfs/{ipfs_hash}"

    try:
        response = requests.get(image_url, timeout=10)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(response.content)
            print(f"Downloaded: {filename}")
        else:
            print(f"Failed to download: {filename}. Status code: {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"Error downloading {filename}: {str(e)}")

def main():
    tokens = fetch_muesliswap_tokens()
    
    if not tokens:
        print("No tokens fetched. Exiting.")
        return

    os.makedirs(os.path.join("public", "assets"), exist_ok=True)

    available_tokens = []
    
    for token in tokens:
        if token['info'].get('status') == 'verified':
            policy_id = token['info']['address']['policyId']
            hex_name = token['info']['address']['name']
            full_name = token['info'].get('symbol', '')  # Using 'symbol' instead of 'name'
            ticker = token['info'].get('symbol', '')  # Using 'symbol' for ticker as well
            decimals = token['info'].get('decimalPlaces', 0)  # Using 'decimalPlaces' instead of 'decimals'

            available_tokens.append({
                "policyId": policy_id,
                "HexName": hex_name,
                "fullName": full_name,
                "Ticker": ticker,
                "Decimals": decimals
            })

            download_image(token)

    # Save the available tokens JSON file
    os.makedirs(os.path.dirname('../availableTokens.json'), exist_ok=True)
    with open('src/availableTokens.json', 'w') as f:
        json.dump(available_tokens, f, indent=2)

    print(f"Token information has been saved to availableTokens.json. Total tokens: {len(available_tokens)}")

if __name__ == "__main__":
    main()