import { describe, expect, it } from 'vitest';
import { parseUsers } from '../src/app/user';

describe('users list', () => {
  it('skips comments and sorts by surname', () => {
    expect(parseUsers('# comment\nM. Sherstyuk\nA. Grimailo\n\nP. Evstratov  # note\nA. Grimailo\n')).toEqual(['P. Evstratov', 'A. Grimailo', 'M. Sherstyuk']);
  });
});
