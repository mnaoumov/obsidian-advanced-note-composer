/**
 * Narrows a string a dropdown reported back to the member of the string enum it names.
 *
 * A dropdown is filled from an enum's own values, so its `onChange` can only ever report one of them, but it
 * reports it typed as `string`. Narrowing by lookup rather than by `as` keeps a value the dropdown should
 * never produce from reaching the setting unnoticed.
 *
 * @param enumType - The string enum the dropdown was filled from.
 * @param value - The value the dropdown reported.
 * @returns The enum member whose value is `value`.
 * @throws If `value` is not the value of any member of `enumType`.
 */
export function toEnumValue<TEnum extends Record<string, string>>(enumType: TEnum, value: string): TEnum[keyof TEnum] {
  for (const key of Object.keys(enumType)) {
    const member = enumType[key as keyof TEnum];
    if (member === value) {
      return member;
    }
  }

  throw new Error(`Invalid enum value: ${value}`);
}
