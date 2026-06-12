#!/bin/bash
# Run once after cloning: bash setup.sh
set -e
git config filter.strip-api-keys.clean 'python3 .githooks/strip_api_keys.py'
git config filter.strip-api-keys.smudge cat
git config filter.strip-api-keys.required 
echo "Done. API key filter is active — keys in Scene.scene will never be committed."
