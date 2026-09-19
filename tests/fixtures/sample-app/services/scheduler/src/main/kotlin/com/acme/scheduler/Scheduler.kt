package com.acme.scheduler

import com.acme.scheduler.jobs.ReconcileJob
import com.acme.scheduler.jobs.*
import kotlinx.coroutines.flow.Flow as KFlow

const val DEFAULT_INTERVAL_SECONDS = 300

interface Job {
    val name: String
    fun run()
}

enum class RunState { IDLE, RUNNING, FAILED }

data class RunReport(val job: String, val state: RunState, val durationMs: Long)

class Scheduler(private val intervalSeconds: Int = DEFAULT_INTERVAL_SECONDS) {
    private val jobs = mutableListOf<Job>()

    val size: Int get() = jobs.size

    fun register(job: Job): Scheduler {
        jobs.add(job)
        return this
    }

    fun runAll(): List<RunReport> = jobs.map { job ->
        job.run()
        RunReport(job.name, RunState.IDLE, 0)
    }

    companion object {
        fun withDefaults(): Scheduler = Scheduler().register(ReconcileJob())
    }
}

object Registry {
    private val known = mutableMapOf<String, Job>()

    fun lookup(name: String): Job? = known[name]
}

fun Int.toIntervalLabel(): String = "${this}s"

typealias JobName = String
