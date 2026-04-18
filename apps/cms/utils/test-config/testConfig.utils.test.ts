import { describe, it, expect } from 'vitest';
import { paddedIndex, testIdModifier, testIds } from './testConfig.utils';

describe('<testIds>', () => {
  describe('<paddedIndex>', () => {
    it('accepts a string', () => {
      expect(paddedIndex('1')).toEqual('0001');
    });
    it('accepts a number', () => {
      expect(paddedIndex(1)).toEqual('0001');
    });
    it('pads a single digit index with three zeros', () => {
      expect(paddedIndex(1)).toEqual('0001');
    });
    it('pads a double digit index with two zeros', () => {
      expect(paddedIndex(12)).toEqual('0012');
    });
    it('pads a 3 digit index with 1 zeros', () => {
      expect(paddedIndex(123)).toEqual('0123');
    });
    it('pads a 4 digit index with 0 zeros', () => {
      expect(paddedIndex(1234)).toEqual('1234');
    });
  });

  describe('<testIdModifier>', () => {
    describe('block and element', () => {
      it('returns a string with the kebab-cased block and element', () => {
        expect(
          testIdModifier('MyComponent', 'MyElement').index(1, false)
        ).toEqual('my-component__my-element--0001');

        expect(testIdModifier('MyComponent', 'MyElement').id('red')).toEqual(
          'my-component__my-element--red'
        );
      });
    });
    describe('<testIdModifier.index>', () => {
      it('returns a string with block and element formatted if element argument is supplied', () => {
        expect(testIdModifier('block', 'element').index(1, false)).toEqual(
          'block__element--0001'
        );
      });

      it('increments the index by 1 if <addOne> is undefined', () => {
        expect(testIdModifier('block', 'element').index(1)).toEqual(
          'block__element--0002'
        );
      });

      it('does not increment the index by 1 if <addOne> is false', () => {
        expect(testIdModifier('block', 'element').index(1, false)).toEqual(
          'block__element--0001'
        );
      });

      it('returns a string with no element if <element> argument is undefined', () => {
        expect(testIdModifier('block').index(1, false)).toEqual('block--0001');
      });
    });

    describe('<testIdModifier.id>', () => {
      it('returns a string with block and element formatted if element argument is supplied', () => {
        expect(testIdModifier('block', 'element').id('red')).toEqual(
          'block__element--red'
        );
      });

      it('returns a string with no element if <element> argument is undefined', () => {
        expect(testIdModifier('block').id('red')).toEqual('block--red');
      });
    });
  });

  describe('<testIds>', () => {
    it('returns a COMPONENT key with the kebab-cased block name', () => {
      expect(testIds('MyComponent').COMPONENT).toEqual('my-component');
    });

    it('returns a COMPONENT key when called with no elements', () => {
      const result = testIds('SiteHeader');
      expect(result).toEqual({ COMPONENT: 'site-header' });
    });

    it('maps element values to block__element format', () => {
      const result = testIds('SiteHeader', {
        LOGO: 'logo',
        NAV: 'navigation',
      });
      expect(result).toEqual({
        COMPONENT: 'site-header',
        LOGO: 'site-header__logo',
        NAV: 'site-header__navigation',
      });
    });

    it('kebab-cases both the block and element values', () => {
      const result = testIds('MyComponent', {
        FIRST_ITEM: 'firstItem',
      });
      expect(result).toEqual({
        COMPONENT: 'my-component',
        FIRST_ITEM: 'my-component__first-item',
      });
    });

    it('handles an empty elements object', () => {
      const result = testIds('Block', {});
      expect(result).toEqual({ COMPONENT: 'block' });
    });
  });
});
