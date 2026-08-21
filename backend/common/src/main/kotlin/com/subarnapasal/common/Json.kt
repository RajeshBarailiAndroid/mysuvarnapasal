package com.subarnapasal.common

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper

/**
 * Dynamic JSON document helpers. The whole POS domain works on a per-user
 * "store" document (maps + lists), mirroring the PHP/Express backends, so
 * these helpers give Kotlin the same ergonomics PHP arrays had.
 */
typealias Doc = MutableMap<String, Any?>

val JSON: ObjectMapper = jacksonObjectMapper()

fun newDoc(vararg pairs: Pair<String, Any?>): Doc = linkedMapOf(*pairs)

@Suppress("UNCHECKED_CAST")
fun Any?.asDocOrNull(): Doc? = this as? MutableMap<String, Any?>

fun Any?.asDoc(): Doc = asDocOrNull() ?: linkedMapOf()

@Suppress("UNCHECKED_CAST")
fun Any?.asList(): MutableList<Any?> = (this as? MutableList<Any?>) ?: mutableListOf()

/** List of docs (skips non-map entries), as a live-copied mutable list. */
fun Any?.asDocList(): MutableList<Doc> {
    val out = mutableListOf<Doc>()
    (this as? List<*>)?.forEach { e -> e.asDocOrNull()?.let(out::add) }
    return out
}

/** Ensure store[key] is a mutable list and return it. */
fun Doc.listAt(key: String): MutableList<Any?> {
    val existing = this[key]
    if (existing is MutableList<*>) @Suppress("UNCHECKED_CAST") return existing as MutableList<Any?>
    val fresh = mutableListOf<Any?>()
    if (existing is List<*>) fresh.addAll(existing)
    this[key] = fresh
    return fresh
}

fun deepCopy(value: Any?): Any? = when (value) {
    is Map<*, *> -> {
        val m: Doc = linkedMapOf()
        value.forEach { (k, v) -> m[k.toString()] = deepCopy(v) }
        m
    }
    is List<*> -> value.mapTo(mutableListOf()) { deepCopy(it) }
    else -> value
}
