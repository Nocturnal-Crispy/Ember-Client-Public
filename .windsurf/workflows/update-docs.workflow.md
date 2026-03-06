---
description: Update Docs
---

Generate script table + env table + update contributing/runbook if used -> staleness check -> summary. Preserve manual prose.

## Steps

1. **Generate Script Table**: Extract and format npm scripts from package.json into a markdown table
2. **Generate Environment Table**: Document environment variables and configuration options
3. **Update Contributing/Runbook**: Update development documentation if it exists
4. **Staleness Check**: Verify all documentation sections are current
5. **Summary**: Provide a summary of changes made

### Implementation Details

- Preserve existing manual prose in documentation
- Only update auto-generated sections marked with <!-- AUTO-GENERATED -->
- Maintain consistent formatting and style
- Update version numbers and dependencies as needed
- Ensure all script descriptions are accurate and helpful
