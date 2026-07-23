package com.careerops.app.util

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TimestampProvider @Inject constructor() {

    fun now(): String = DateTimeFormatter.ISO_INSTANT.format(Instant.now())

    fun today(): String = DateTimeFormatter.ISO_LOCAL_DATE.format(
        Instant.now().atZone(ZoneOffset.UTC)
    )
}
