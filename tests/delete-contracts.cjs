// Prueba aislada de rutas: no necesita PostgreSQL y no modifica información real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const apiDir = path.resolve(__dirname, '../src/app/api');
function fakeSchema() {
  const chain = {};
  for (const method of ['trim', 'min', 'max', 'nonnegative', 'positive', 'optional', 'nullable', 'nullish', 'regex', 'strict']) chain[method] = () => chain;
  chain.safeParse = data => ({ success: true, data });
  return chain;
}
const z = { object: fakeSchema, string: fakeSchema, number: fakeSchema, boolean: fakeSchema, enum: fakeSchema, uuid: fakeSchema, null: fakeSchema, union: fakeSchema };
function loadRoute(file, prisma) {
  const source = fs.readFileSync(path.join(apiDir, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const response = (data, status = 200) => ({ status, body: data });
  const mocks = {
    'next/server': { NextResponse: { json: (data, opts = {}) => response(data, opts.status) } },
    'zod': { z },
    '@prisma/client': { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
    '@/lib/prisma': { prisma },
    '@/app/api/auth/session': { getAuthenticatedUser: async () => ({ id: 'user-1' }) },
    '@/lib/api-response': {
      ok: (data, message = 'OK', status = 200) => response({ success: true, message, data }, status),
      fail: (message, status = 400, errors) => response({ success: false, message, errors }, status),
      internal: err => { throw err; },
      invalid: err => { throw err; },
    },
  };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in mocks)) throw new Error(`Dependencia inesperada: ${id}`);
    return mocks[id];
  }, module, module.exports);
  return module.exports;
}
function fakePrisma(accountTransactions = 0, categoryDependencies = [0, 0, 0, 0, 0]) {
  const calls = [];
  const record = name => async arg => { calls.push([name, arg]); return { id: 'account-1', name: 'Cuenta de prueba', type: 'CASH', openingBalance: 0, creditLimit: null }; };
  const prisma = {
    account: {
      findFirst: async () => ({ id: 'account-1', isDefault: false }),
      findMany: async () => [],
      delete: record('account.delete'),
      update: record('account.update'),
      updateMany: record('account.updateMany'),
    },
    transaction: {
      count: async () => accountTransactions,
      findMany: async () => Array.from({ length: accountTransactions }, (_, i) => ({ id: `t-${i}` })),
      deleteMany: record('transaction.deleteMany'),
      updateMany: record('transaction.updateMany'),
    },
    goalContribution: { deleteMany: record('goalContribution.deleteMany') },
    debtPayment: { deleteMany: record('debtPayment.deleteMany') },
    category: {
      findFirst: async () => ({ id: 'category-1', isSystem: false }),
      findMany: async () => [],
      count: async () => categoryDependencies[3],
      delete: record('category.delete'),
      update: record('category.update'),
      updateMany: record('category.updateMany'),
    },
    budget: { count: async () => categoryDependencies[1], deleteMany: record('budget.deleteMany') },
    transactionSplit: { count: async () => categoryDependencies[2], deleteMany: record('transactionSplit.deleteMany') },
    recurringTransaction: { count: async () => categoryDependencies[4], updateMany: record('recurringTransaction.updateMany') },
  };
  prisma.$transaction = async fn => fn(prisma);
  return { prisma, calls };
}
(async function main() {
  let passed = 0;
  {
    const { prisma, calls } = fakePrisma();
    const route = loadRoute('account/[id]/route.ts', prisma);
    const response = await route.DELETE(new Request('http://localhost/api/account/account-1'), { params: Promise.resolve({ id: 'account-1' }) });
    assert.equal(response.status, 200); assert.equal(response.body.data.deleted, true);
    assert(calls.some(([operation]) => operation === 'account.delete'));
    passed++;
  }
  {
    const { prisma, calls } = fakePrisma(3);
    const route = loadRoute('account/[id]/route.ts', prisma);
    const response = await route.DELETE(new Request('http://localhost/api/account/account-1'), { params: Promise.resolve({ id: 'account-1' }) });
    assert.equal(response.status, 409);
    assert.equal(response.body.errors.transactions, '3');
    assert(!calls.some(([operation]) => operation === 'account.delete'));
    passed++;
  }
  {
    const { prisma, calls } = fakePrisma(3);
    const route = loadRoute('account/[id]/route.ts', prisma);
    const response = await route.DELETE(new Request('http://localhost/api/account/account-1?force=true'), { params: Promise.resolve({ id: 'account-1' }) });
    assert.equal(response.status, 200); assert.equal(response.body.data.deletedTransactions, 3);
    for (const op of ['goalContribution.deleteMany', 'debtPayment.deleteMany', 'transaction.deleteMany', 'account.delete']) assert(calls.some(([name]) => name === op));
    passed++;
  }
  {
    const { prisma, calls } = fakePrisma();
    const route = loadRoute('category/[type]/route.ts', prisma);
    const response = await route.DELETE(new Request('http://localhost/api/category/7d2bcd77-3c9e-4f25-98b2-ab9015278122'), { params: Promise.resolve({ type: '7d2bcd77-3c9e-4f25-98b2-ab9015278122' }) });
    assert.equal(response.status, 200); assert(calls.some(([name]) => name === 'category.delete'));
    passed++;
  }
  {
    const { prisma, calls } = fakePrisma(0, [2, 1, 0, 0, 0]);
    const route = loadRoute('category/[type]/route.ts', prisma);
    const response = await route.DELETE(new Request('http://localhost/api/category/7d2bcd77-3c9e-4f25-98b2-ab9015278122'), { params: Promise.resolve({ type: '7d2bcd77-3c9e-4f25-98b2-ab9015278122' }) });
    assert.equal(response.status, 409); assert.equal(response.body.errors.movements, '0');
    assert(!calls.some(([name]) => name === 'category.delete'));
    passed++;
  }
  {
    const { prisma, calls } = fakePrisma(0, [2, 1, 0, 0, 0]);
    prisma.transaction.count = async () => 2;
    const route = loadRoute('category/[type]/route.ts', prisma);
    const response = await route.DELETE(new Request('http://localhost/api/category/7d2bcd77-3c9e-4f25-98b2-ab9015278122?force=true'), { params: Promise.resolve({ type: '7d2bcd77-3c9e-4f25-98b2-ab9015278122' }) });
    assert.equal(response.status, 200); assert.equal(response.body.data.unlinkedTransactions, 2);
    for (const op of ['transaction.updateMany', 'budget.deleteMany', 'category.delete']) assert(calls.some(([name]) => name === op));
    passed++;
  }
  console.log(`Pruebas aisladas de eliminación: ${passed}/6 superadas`);
})().catch(err => { console.error(err); process.exitCode = 1; });
