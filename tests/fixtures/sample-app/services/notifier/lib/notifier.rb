# frozen_string_literal: true

require 'set'
require_relative 'channels/email'

module Notifier
  DEFAULT_CHANNEL = 'email'

  # Routes a notification to a channel.
  class Dispatcher
    attr_accessor :channel

    def self.default
      new(Channels::Email.build('ops@example.com'))
    end

    def initialize(channel)
      @channel = channel
    end

    def dispatch(subject, body)
      @channel.deliver(subject, body)
    end
  end

  module Formatting
    def self.title(text)
      text.to_s.strip
    end
  end
end
