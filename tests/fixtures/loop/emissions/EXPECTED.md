# Emissions fixture: expected result

This document states the expected result of the fixture calculation **separately** from the code and from the test data, so that a repair cannot make a test pass by changing the expected value: the value below, the fixture data file and the check are all protected.

| Input | Value |
|---|---|
| Mass | 1000 kg (invented) |
| Factor | 2.5 kg per kg (invented) |

Rule under test: result = mass multiplied by factor. Expected result: **2500 kg**. The deliberate bug adds instead of multiplying and returns 1002.5.

**This is a test fixture only.** The numbers are invented for the repair-loop tests. They are not a certification-scheme factor, a methodology, a standard or a measurement, and nothing here implies that any scheme calculates emissions this way. Real calculations belong to versioned, reviewed methodology records (hard constraint HC-05) that do not exist yet.
