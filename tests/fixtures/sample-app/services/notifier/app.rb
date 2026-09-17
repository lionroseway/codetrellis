# frozen_string_literal: true

require_relative 'lib/notifier'

# Entry point for the fixture notifier service.
def main
  Notifier::Dispatcher.default.dispatch('hello', 'world')
end
