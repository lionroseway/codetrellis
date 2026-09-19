package com.acme.scheduler.jobs

import com.acme.scheduler.Job

class ReconcileJob : Job {
    override val name: String = "reconcile"

    private var runs: Int = 0

    override fun run() {
        runs += 1
    }

    fun runCount(): Int = runs
}
