#!/bin/bash

# Build script that injects API key during compilation
# This keeps the key out of source code and only in the built version

set -e

# Configuration
API_KEY_FILE=".klipy-api-key"
OUTPUT_FILE="src/main/api-key.ts"
TEMPLATE_FILE="src/main/api-key-template.ts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Handle command line arguments
INJECT_ONLY=false
if [ "$1" = "--inject-only" ]; then
    INJECT_ONLY=true
fi

if [ "$INJECT_ONLY" = false ]; then
    echo -e "${GREEN}🔐 Secure Build Process Starting...${NC}"
fi

# Check if API key file exists
if [ ! -f "$API_KEY_FILE" ]; then
    echo -e "${YELLOW}⚠️  API key file not found: $API_KEY_FILE${NC}"
    echo -e "${YELLOW}📝 Creating API key file...${NC}"
    
    # Prompt for API key
    read -p "Enter your Klipy API key: " -s api_key
    echo
    
    if [ -z "$api_key" ]; then
        echo -e "${RED}❌ No API key provided. Build cancelled.${NC}"
        exit 1
    fi
    
    # Save API key to file (add to .gitignore)
    echo "$api_key" > "$API_KEY_FILE"
    echo -e "${GREEN}✅ API key saved to $API_KEY_FILE${NC}"
    echo -e "${YELLOW}📝 Make sure $API_KEY_FILE is in your .gitignore${NC}"
fi

# Read the API key (strip whitespace and newlines)
API_KEY=$(cat "$API_KEY_FILE" | tr -d '\n\r ')

if [ "$INJECT_ONLY" = false ]; then
    echo -e "${GREEN}🔧 Injecting API key into build...${NC}"
fi

# Create the actual api-key.ts file with the injected key
cat > "$OUTPUT_FILE" << EOF
// Generated during build - DO NOT EDIT MANUALLY
// API key injected at build time to keep it out of source control

// Simple obfuscation - split key into parts
const keyParts = [
  "$(echo -n "$API_KEY" | cut -c1-16)",
  "$(echo -n "$API_KEY" | cut -c17-32)",
  "$(echo -n "$API_KEY" | cut -c33-48)",
  "$(echo -n "$API_KEY" | cut -c49-64)"
];

// Reconstruct the key
const KLIPPY_API_KEY: string = keyParts.join('');

export { KLIPPY_API_KEY };
EOF

if [ "$INJECT_ONLY" = false ]; then
    echo -e "${GREEN}✅ API key injected successfully${NC}"
fi

# Build the application (only if not inject-only)
if [ "$INJECT_ONLY" = false ]; then
    echo -e "${GREEN}🏗️  Building application...${NC}"
    npm run build:shared
    tsc -p tsconfig.main.json
    tsc -p tsconfig.renderer.json
    cp -r src/renderer/*.html dist/renderer/ 2>/dev/null || true
    cp -r src/renderer/styles dist/renderer/ 2>/dev/null || true
    mkdir -p dist/renderer/assets/icons 2>/dev/null || true
    cp -r assets/icons/* dist/renderer/assets/icons/ 2>/dev/null || true
    
    # Clean up the generated file after build
    echo -e "${GREEN}🧹 Cleaning up temporary files...${NC}"
    rm "$OUTPUT_FILE"
    
    echo -e "${GREEN}🎉 Build completed successfully!${NC}"
    echo -e "${GREEN}📦 API key is only in the built version, not in source code${NC}"
else
    echo -e "${GREEN}✅ API key injected for development build${NC}"
fi
