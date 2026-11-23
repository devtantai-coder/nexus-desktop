/** Kiểu JSON giống hệt hành vi của `nlohmann::json` ở bản C++. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = any
