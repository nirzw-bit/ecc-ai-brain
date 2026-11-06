from datetime import datetime, timezone, timedelta
import unittest
from controller import build_plan

NOW = datetime(2026, 11, 6, 20, 0, tzinfo=timezone.utc)


def roles(plan):
    return {item['role']: item for item in plan['actions']}


class ControllerTests(unittest.TestCase):
    def test_default_auditor_eligible_and_downstream_blocked(self):
        r = roles(build_plan({}, NOW))
        self.assertEqual(r['independent_auditor']['decision'], 'ELIGIBLE')
        self.assertEqual(r['reliability']['decision'], 'BLOCKED')
        self.assertEqual(r['efficiency_challenge']['decision'], 'BLOCKED')

    def test_existing_chatgpt_roles_are_never_replaced(self):
        self.assertEqual(build_plan({}, NOW)['existing_chatgpt_roles'], 'UNCHANGED')

    def test_controller_is_planning_only_and_offline(self):
        p = build_plan({}, NOW)
        self.assertTrue(p['planning_only'])
        self.assertFalse(p['external_calls'])
        self.assertFalse(p['production_mutations'])

    def test_reliability_can_start_only_after_archive_pass(self):
        p = build_plan({'archive_verification': {'status': 'PASS'}}, NOW)
        self.assertEqual(roles(p)['reliability']['decision'], 'ELIGIBLE_TO_START')

    def test_archive_fail_blocks_reliability(self):
        p = build_plan({'archive_verification': {'status': 'FAIL'}}, NOW)
        self.assertEqual(roles(p)['reliability']['decision'], 'BLOCKED')

    def test_archive_in_progress_blocks_reliability(self):
        p = build_plan({'archive_verification': {'status': 'IN_PROGRESS'}}, NOW)
        self.assertEqual(roles(p)['reliability']['decision'], 'BLOCKED')

    def test_reliability_observation_continues_before_24h(self):
        started = (NOW - timedelta(hours=23)).isoformat()
        state = {'archive_verification': {'status': 'PASS'}, 'reliability': {'status': 'IN_PROGRESS', 'started_at': started}}
        self.assertEqual(roles(build_plan(state, NOW))['reliability']['decision'], 'CONTINUE_OBSERVATION')

    def test_reliability_requires_final_review_after_24h(self):
        started = (NOW - timedelta(hours=24)).isoformat()
        state = {'archive_verification': {'status': 'PASS'}, 'reliability': {'status': 'IN_PROGRESS', 'started_at': started}}
        self.assertEqual(roles(build_plan(state, NOW))['reliability']['decision'], 'READY_FOR_FINAL_REVIEW')

    def test_efficiency_waits_for_reliability_pass(self):
        state = {'archive_verification': {'status': 'PASS'}, 'reliability': {'status': 'IN_PROGRESS'}}
        self.assertEqual(roles(build_plan(state, NOW))['efficiency_challenge']['decision'], 'BLOCKED')

    def test_efficiency_eligible_after_reliability_pass(self):
        state = {'archive_verification': {'status': 'PASS'}, 'reliability': {'status': 'PASS'}}
        self.assertEqual(roles(build_plan(state, NOW))['efficiency_challenge']['decision'], 'ELIGIBLE')

    def test_auditor_respects_future_due_time(self):
        due = (NOW + timedelta(hours=1)).isoformat()
        state = {'independent_auditor': {'next_due_at': due}}
        self.assertEqual(roles(build_plan(state, NOW))['independent_auditor']['decision'], 'NOT_DUE')

    def test_rejects_unknown_status(self):
        with self.assertRaises(ValueError):
            build_plan({'archive_verification': {'status': 'SUCCESS'}}, NOW)

    def test_rejects_timezone_naive_now(self):
        with self.assertRaises(ValueError):
            build_plan({}, datetime(2026, 11, 6, 20, 0))


if __name__ == '__main__':
    unittest.main()
