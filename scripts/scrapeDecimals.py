import requests
import json
import os

def fetch_muesliswap_tokens():
    url = "https://api.muesliswap.com/token-list"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Failed to fetch token list from MuesliSwap API. Status code: {response.status_code}")
        return None

def main():
    # Load existing supportedTokens.json
    try:
        with open('src/components/supportedTokens.json', 'r') as f:
            supported_tokens = json.load(f)
    except FileNotFoundError:
        supported_tokens = {}

    tokens = fetch_muesliswap_tokens()
    
    if not tokens:
        print("No tokens fetched. Exiting.")
        return

    for token in tokens:
        policy_id = token['address']['policyId']
        token_name = token['address']['name']
        
        if policy_id not in supported_tokens:
            supported_tokens[policy_id] = {
                "project": token_name,
                "categories": [],
                "socialLinks": {},
            }
        
        # Update or add decimals information
        supported_tokens[policy_id]["decimals"] = token["decimalPlaces"]
        
        # Update project name if it has changed
        # if supported_tokens[policy_id]["project"] != bytes.fromhex(token_name).decode('utf-8'):
        #     print(f"Updating project name for {policy_id} from {supported_tokens[policy_id]['project']} to {token_name}")
        #     supported_tokens[policy_id]["project"] = token_name

    # Save the updated supportedTokens.json file
    with open('src/components/supportedTokens.json', 'w') as f:
        json.dump(supported_tokens, f, indent=2)

    print(f"Token information has been updated in supportedTokens.json. Total tokens: {len(supported_tokens)}")

if __name__ == "__main__":
    main()
