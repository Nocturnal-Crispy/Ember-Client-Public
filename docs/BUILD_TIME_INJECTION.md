# Build-Time API Key Injection

## Overview
This approach completely removes the API key from source code and only injects it during the build process. This provides maximum security while maintaining functionality.

## How It Works

### **Source Code (Clean)**
```
src/main/api-key-template.ts  # Template file - no key
.klipy-api-key                # Key file (gitignored)
```

### **Build Process**
1. Read API key from `.klipy-api-key` file
2. Generate `src/main/api-key.ts` with obfuscated key
3. Compile TypeScript to JavaScript
4. Delete temporary `api-key.ts` file
5. Key only exists in compiled JavaScript

### **Built Application (Contains Key)**
```
dist/main/index.js  # Contains obfuscated API key
```

## Setup Instructions

### 1. Initial Setup
```bash
# The build script will create this automatically
echo "your_api_key_here" > .klipy-api-key
```

### 2. Build Commands

#### **Development Build**
```bash
npm run build
```
- Injects key temporarily
- Builds application
- Cleans up temporary files

#### **Secure Production Build**
```bash
npm run secure-build
```
- Full secure build process
- Key injection + compilation
- Cleanup after build

#### **Distribution Builds**
```bash
npm run dist          # Secure build + package
npm run dist:linux    # Linux AppImage + deb
npm run dist:win      # Windows installer + portable
npm run dist:mac      # macOS DMG + zip
```

## Security Benefits

### ✅ **What This Prevents**
- **Source code inspection**: Key never in git repository
- **Accidental commits**: Key file in .gitignore
- **Code sharing**: Clean source code for collaboration
- **Repository breaches**: Key not in version control

### ✅ **What This Provides**
- **Runtime access**: Key available when app runs
- **All users**: Same key for everyone
- **Zero configuration**: Users don't need to set anything
- **Obfuscation**: Key XOR-encoded in compiled code

## File Structure

```
ember-client/
├── .klipy-api-key              # API key (gitignored)
├── .gitignore                  # Excludes key files
├── src/main/
│   ├── api-key-template.ts     # Template (no key)
│   └── index.ts                # Imports KLIPPY_API_KEY
├── scripts/
│   └── secure-build.sh         # Build script
├── dist/main/
│   └── index.js                # Compiled with obfuscated key
└── package.json                # Build commands
```

## Development Workflow

### **First Time Setup**
```bash
# 1. Clone repository (no API key)
git clone <repository>

# 2. Install dependencies
npm install

# 3. Build (will prompt for API key)
npm run secure-build
```

### **Daily Development**
```bash
# Normal development build
npm run build
npm start
```

### **Release Process**
```bash
# Secure distribution build
npm run dist:linux
```

## Team Collaboration

### **For Team Members**
```bash
# Get API key from team lead
echo "your_team_api_key" > .klipy-api-key

# Build normally
npm run build
```

### **For CI/CD**
```bash
# Set environment variable in CI system
export KLIPPY_API_KEY="production_key"

# Build with environment variable
KLIPPY_API_KEY="$KLIPPY_API_KEY" npm run secure-build
```

## Advanced Options

### **Environment Variable Injection**
```bash
# Use environment variable instead of file
KLIPPY_API_KEY="your_key" npm run secure-build
```

### **Custom Build Scripts**
```bash
# Modify scripts/secure-build.sh for:
# - Different obfuscation methods
# - Multiple API keys
# - Environment-specific keys
```

## Security Comparison

| Method | Source Code | Git History | Build Process | Runtime |
|--------|-------------|-------------|---------------|---------|
| Hardcoded | ❌ Visible | ❌ Commits | ✅ Simple | ✅ Available |
| Environment | ✅ Clean | ✅ Clean | ❌ Complex | ✅ Available |
| **Build Injection** | ✅ **Clean** | ✅ **Clean** | ✅ **Secure** | ✅ **Available** |

## Troubleshooting

### **API Key Not Found**
```bash
# Create the key file
echo "your_klipy_api_key" > .klipy-api-key
```

### **Build Fails**
```bash
# Check file permissions
chmod +x scripts/secure-build.sh

# Verify key file exists
ls -la .klipy-api-key
```

### **Key Not Working**
```bash
# Test key injection
./scripts/secure-build.sh --inject-only
cat src/main/api-key.ts  # Should show obfuscated key
```

## Migration from Old Method

### **From Source Code**
1. Move API key to `.klipy-api-key` file
2. Delete `src/main/api-key.ts`
3. Add `.klipy-api-key` to `.gitignore`
4. Use new build commands

### **From Environment Variables**
1. Create `.klipy-api-key` file
2. Update build scripts
3. Remove environment variable dependencies

## Best Practices

1. **Never commit** `.klipy-api-key` to version control
2. **Use different keys** for development/production
3. **Rotate keys** regularly through Klipy dashboard
4. **Limit key access** to team members who need it
5. **Monitor usage** through Klipy analytics
6. **Secure backup** of API keys separately

This approach provides the best balance of security, usability, and maintainability for desktop applications.
