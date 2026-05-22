import { describe, it, expect } from 'vitest'

describe('Project Setup', () => {
  it('should have all required dependencies installed', async () => {
    const pkg = await import('../package.json', { assert: { type: 'json' } })
    expect(pkg.default.dependencies).toHaveProperty('@soid/koa')
    expect(pkg.default.dependencies).toHaveProperty('koa')
    expect(pkg.default.dependencies).toHaveProperty('jose')
    expect(pkg.default.devDependencies).toHaveProperty('vitest')
  })
})
