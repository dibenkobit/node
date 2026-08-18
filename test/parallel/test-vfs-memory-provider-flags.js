// Flags: --experimental-vfs
'use strict';

// MemoryProvider: open flags, numeric and string, must be interpreted the
// way fs interprets them.

require('../common');
const assert = require('assert');
const fs = require('fs');
const vfs = require('node:vfs');

const { O_RDONLY, O_RDWR, O_WRONLY, O_CREAT, O_TRUNC, O_EXCL, O_APPEND } = fs.constants;

const myVfs = vfs.create();
myVfs.writeFileSync('/file.txt', 'orig');

// O_RDONLY (0)
myVfs.closeSync(myVfs.openSync('/file.txt', O_RDONLY));

// O_RDWR ('r+')
myVfs.closeSync(myVfs.openSync('/file.txt', O_RDWR));

// 'w' = O_WRONLY | O_CREAT | O_TRUNC
myVfs.closeSync(myVfs.openSync('/created.txt', O_WRONLY | O_CREAT | O_TRUNC));

// 'wx' = O_WRONLY | O_CREAT | O_EXCL
myVfs.closeSync(myVfs.openSync('/excl.txt', O_WRONLY | O_CREAT | O_EXCL));

// 'wx' on an existing file throws EEXIST
assert.throws(
  () => myVfs.openSync('/file.txt', O_WRONLY | O_CREAT | O_EXCL),
  { code: 'EEXIST' });

// 'a' = O_APPEND | O_RDWR | O_CREAT (mapped to 'a+')
myVfs.closeSync(myVfs.openSync('/app.txt', O_APPEND | O_RDWR | O_CREAT));

// 'ax+' = O_APPEND | O_EXCL | O_RDWR | O_CREAT
myVfs.closeSync(myVfs.openSync('/axplus.txt',
                               O_APPEND | O_EXCL | O_RDWR | O_CREAT));

// A null or undefined flag means O_RDONLY, as it does in fs.
myVfs.closeSync(myVfs.openSync('/file.txt', null));
myVfs.closeSync(myVfs.openSync('/file.txt', undefined));

// Anything else is rejected, as fs rejects it.
for (const bogus of [true, {}, []]) {
  assert.throws(() => myVfs.openSync('/file.txt', bogus),
                { code: 'ERR_INVALID_ARG_VALUE' });
}

// Invalid flag strings are rejected the way fs rejects them.
for (const bogus of ['zz', 'rw', '']) {
  assert.throws(() => myVfs.openSync('/file.txt', bogus),
                { code: 'ERR_INVALID_ARG_VALUE' });
  assert.throws(() => fs.openSync(__filename, bogus),
                { code: 'ERR_INVALID_ARG_VALUE' });
}

// The synchronised append flags create the file, like 'a' does.
for (const flag of ['as', 'as+']) {
  const appendVfs = vfs.create();
  appendVfs.closeSync(appendVfs.openSync('/new.txt', flag));
  assert.strictEqual(appendVfs.existsSync('/new.txt'), true);
}

// 'rs' is read-only, so writing through it fails like 'r' does.
for (const readOnly of ['r', 'rs']) {
  const fd = myVfs.openSync('/file.txt', readOnly);
  assert.throws(() => myVfs.writeSync(fd, Buffer.from('x'), 0, 1, 0),
                { code: 'EBADF' });
  myVfs.closeSync(fd);
}

// Only O_TRUNC truncates; a numeric flag that merely allows writing must
// leave the contents alone.
for (const [name, numeric] of [
  ['O_WRONLY', O_WRONLY],
  ['O_RDWR', O_RDWR],
  ['O_CREAT | O_RDWR', O_CREAT | O_RDWR],
  ['O_CREAT | O_WRONLY', O_CREAT | O_WRONLY],
]) {
  const keepVfs = vfs.create();
  keepVfs.writeFileSync('/keep.txt', 'ABCD');
  keepVfs.closeSync(keepVfs.openSync('/keep.txt', numeric));
  assert.strictEqual(keepVfs.readFileSync('/keep.txt', 'utf8'), 'ABCD', name);
}

const truncVfs = vfs.create();
truncVfs.writeFileSync('/trunc.txt', 'ABCD');
truncVfs.closeSync(truncVfs.openSync('/trunc.txt', O_TRUNC | O_WRONLY));
assert.strictEqual(truncVfs.readFileSync('/trunc.txt', 'utf8'), '');

// O_EXCL only has an effect together with O_CREAT, as it does in fs.
{
  const exclVfs = vfs.create();
  exclVfs.writeFileSync('/there.txt', 'ABCD');
  exclVfs.closeSync(exclVfs.openSync('/there.txt', O_EXCL));
  exclVfs.closeSync(exclVfs.openSync('/there.txt', O_EXCL | O_RDONLY));
  assert.throws(() => exclVfs.openSync('/there.txt', O_EXCL | O_CREAT),
                { code: 'EEXIST' });
}

// A read-only provider rejects every open that would change it, including the
// ones that ask for no writable descriptor at all.
{
  const roVfs = vfs.create();
  roVfs.writeFileSync('/seed.txt', 'ABCD');
  roVfs.provider.setReadOnly();

  assert.throws(() => roVfs.openSync('/seed.txt', O_TRUNC), { code: 'EROFS' });
  assert.strictEqual(roVfs.readFileSync('/seed.txt', 'utf8'), 'ABCD');

  assert.throws(() => roVfs.openSync('/new.txt', O_CREAT), { code: 'EROFS' });
  assert.strictEqual(roVfs.existsSync('/new.txt'), false);

  assert.throws(() => roVfs.openSync('/seed.txt', 'w'), { code: 'EROFS' });

  // Read-only opens still work, including the synchronised spellings.
  for (const readOnly of ['r', 'rs', O_RDONLY]) {
    roVfs.closeSync(roVfs.openSync('/seed.txt', readOnly));
  }
}

// A write-only numeric handle refuses reads, like fs does.
{
  const woVfs = vfs.create();
  woVfs.writeFileSync('/wo.txt', 'ABCD');
  const fd = woVfs.openSync('/wo.txt', O_WRONLY);
  assert.throws(() => woVfs.readSync(fd, Buffer.alloc(4), 0, 4, 0),
                { code: 'EBADF' });
  woVfs.closeSync(fd);
}

// Without O_CREAT a missing file is not created.
{
  const missingVfs = vfs.create();
  assert.throws(() => missingVfs.openSync('/missing.txt', O_WRONLY),
                { code: 'ENOENT' });
  assert.strictEqual(missingVfs.existsSync('/missing.txt'), false);
}

// O_CREAT on a read-only provider only fails when the file has to be created.
{
  const roVfs2 = vfs.create();
  roVfs2.writeFileSync('/there.txt', 'ABCD');
  roVfs2.provider.setReadOnly();

  roVfs2.closeSync(roVfs2.openSync('/there.txt', O_CREAT));
  assert.throws(() => roVfs2.openSync('/absent.txt', O_CREAT),
                { code: 'EROFS' });
  assert.throws(() => roVfs2.openSync('/there.txt', O_CREAT | O_EXCL),
                { code: 'EEXIST' });
}
