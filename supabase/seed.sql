-- RV BUSINESS HUB — local seed
--
-- Reference data (the four businesses and the standard income/expense
-- categories) is created by migration 20261015000002_reference_data.sql so it
-- reaches every environment, including production.
--
-- This file intentionally inserts NO income or expense records. Never seed
-- fake financial data into production. For local experimentation, add test
-- transactions through the application while signed in as the administrator.
select 1;
