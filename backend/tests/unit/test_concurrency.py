import asyncio
import threading
import time


def test_run_workflow_blocking_queues_without_threadpool_deadlock(settings_env) -> None:
    from app.concurrency import run_workflow_blocking

    active = 0
    max_active = 0
    lock = threading.Lock()

    def blocking_work(index: int) -> int:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.01)
        with lock:
            active -= 1
        return index

    async def run_many() -> list[int]:
        tasks = [run_workflow_blocking(blocking_work, index) for index in range(80)]
        return await asyncio.wait_for(asyncio.gather(*tasks), timeout=3)

    settings_env(WORKFLOW_MAX_WORKERS="2")
    assert asyncio.run(run_many()) == list(range(80))
    assert max_active == 2


def test_gather_workflow_limited_caps_async_tasks(settings_env) -> None:
    from app.concurrency import gather_workflow_limited

    active = 0
    max_active = 0

    async def async_work(index: int) -> int:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return index

    settings_env(WORKFLOW_MAX_WORKERS="2")
    assert asyncio.run(gather_workflow_limited(list(range(6)), async_work)) == list(range(6))
    assert max_active == 2


def test_module_batch_workers_use_workflow_worker_limit(settings_env) -> None:
    from app import document_modules
    from app.concurrency import run_workflow_blocking

    active = 0
    max_active = 0
    finalized = False
    lock = threading.Lock()

    def blocking_work(_job_id: str) -> None:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.03)
        with lock:
            active -= 1

    async def fake_runner(job_id: str) -> None:
        await run_workflow_blocking(blocking_work, job_id)

    def fake_failer(_job_id: str, message: str) -> None:
        raise AssertionError(message)

    def fake_finalizer() -> None:
        nonlocal finalized
        finalized = True

    settings_env(WORKFLOW_MAX_WORKERS="2")
    asyncio.run(document_modules._run_parallel_batch_async(["job_1", "job_2", "job_3", "job_4"], fake_runner, fake_failer, fake_finalizer))
    assert max_active == 2
    assert finalized is True


def test_module_batch_async_workers_use_workflow_worker_limit(settings_env) -> None:
    from app import document_modules

    active = 0
    max_active = 0
    finalized = False

    async def fake_runner(_job_id: str) -> None:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1

    def fake_failer(_job_id: str, message: str) -> None:
        raise AssertionError(message)

    def fake_finalizer() -> None:
        nonlocal finalized
        finalized = True

    settings_env(WORKFLOW_MAX_WORKERS="2")
    asyncio.run(document_modules._run_parallel_batch_async(["job_1", "job_2", "job_3", "job_4"], fake_runner, fake_failer, fake_finalizer))
    assert max_active == 2
    assert finalized is True
