You have not finished this step yet: the tool `report_done` was not called successfully.

The harness checks did NOT pass:
- the test suite failed (`python3 -m unittest discover -s tests -v` exited 1).

Last lines of the test run:
```
test_app (unittest.loader._FailedTest.test_app) ... ERROR

======================================================================
ERROR: test_app (unittest.loader._FailedTest.test_app)
----------------------------------------------------------------------
ImportError: Failed to import test module: test_app
Traceback (most recent call last):
  File "/usr/lib/python3.11/unittest/loader.py", line 407, in _find_test_path
    module = self._get_module_from_name(name)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.11/unittest/loader.py", line 350, in _get_module_from_name
    __import__(name)
  File "/workspace/tests/test_app.py", line 10, in <module>
    from app import BookHandler, HTTPServer
  File "/workspace/app.py", line 43
    global next_id
    ^^^^^^^^^^^^^^
SyntaxError: name 'next_id' is used prior to global declaration


----------------------------------------------------------------------
Ran 1 test in 0.000s

FAILED (errors=1)
```
Fix what is wrong, run the tests, then call `report_done`.